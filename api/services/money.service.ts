import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import {
  customers,
  expenseCategories,
  expenses,
  moneyMovements,
  payments,
  salaryPayments,
  staffLoans,
  users,
} from "@db/schema";
import type { MoneyDirection, MoneyMethod, MoneySource } from "@contracts/index";
import type { getDb } from "../queries/connection";

/**
 * YABUZ OIL & GAS — Money movements service
 * One unified, read-only view of every REAL money event in the business:
 *
 *   MONEY IN   confirmed payments (sale / credit repayment / advance deposit)
 *              in cash, bank transfer, POS or cheque — DEPOSIT_BALANCE and
 *              credit sales are excluded (they move no actual money) —
 *              plus manual "other in" entries.
 *   MONEY OUT  approved expenses (incl. the auto-created salary & staff-loan
 *              expenses, attributed back to SALARY / LOAN), confirmed deposit
 *              refunds, plus manual "other out" entries.
 *
 * Used by the Money page, the money-movements report and analytics.
 */

type Db = ReturnType<typeof getDb>;

export interface MoneyMovementRow {
  id: string; // "pay-12" | "exp-7" | "mm-3"
  date: string; // ISO-ish (yyyy-mm-dd...) for sorting + display
  reference: string;
  direction: MoneyDirection;
  source: MoneySource;
  method: MoneyMethod;
  amount: number;
  party: string | null; // customer / vendor / staff
  description: string;
  recordedBy: string | null;
}

export interface MoneyFilters {
  dateFrom?: string; // yyyy-mm-dd
  dateTo?: string;
  direction?: MoneyDirection;
  method?: MoneyMethod;
  source?: MoneySource;
  search?: string;
}

export interface MoneySummary {
  totalIn: number;
  totalOut: number;
  net: number;
  count: number;
  /** Per-method breakdown, always all four methods. */
  methods: { method: MoneyMethod; in: number; out: number; balance: number }[];
  /** Per-source totals (signed: in positive, out negative shown separately). */
  sources: { source: MoneySource; direction: MoneyDirection; total: number; count: number }[];
}

const METHODS: MoneyMethod[] = ["CASH", "BANK_TRANSFER", "POS", "CHEQUE"];

function isoDay(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Pull every real-money movement in the window and normalize it. */
export async function listMoneyMovements(db: Db, filters: MoneyFilters): Promise<MoneyMovementRow[]> {
  const rows: MoneyMovementRow[] = [];
  const fromTs = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
  const toTs = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;

  /* ---- 1. Confirmed payments (money in + deposit refunds out) ---- */
  const payConds = [eq(payments.status, "CONFIRMED")];
  if (fromTs) payConds.push(gte(payments.createdAt, fromTs));
  if (toTs) payConds.push(lte(payments.createdAt, toTs));
  const payRows = await db
    .select({
      id: payments.id,
      reference: payments.reference,
      paymentType: payments.paymentType,
      method: payments.method,
      amount: payments.amount,
      createdAt: payments.createdAt,
      notes: payments.notes,
      customerName: customers.fullName,
      recorderName: users.fullName,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .leftJoin(users, eq(payments.recordedBy, users.id))
    .where(and(...payConds))
    .orderBy(desc(payments.createdAt))
    .limit(2000);

  for (const p of payRows) {
    if (p.method === "DEPOSIT_BALANCE") continue; // wallet money, not new money
    const method = p.method as MoneyMethod;
    if (p.paymentType === "DEPOSIT_REFUND") {
      rows.push({
        id: `pay-${p.id}`,
        date: p.createdAt.toISOString(),
        reference: p.reference,
        direction: "OUT",
        source: "DEPOSIT_REFUND",
        method,
        amount: Math.abs(p.amount),
        party: p.customerName,
        description: p.notes || "Deposit refunded to customer",
        recordedBy: p.recorderName,
      });
    } else {
      rows.push({
        id: `pay-${p.id}`,
        date: p.createdAt.toISOString(),
        reference: p.reference,
        direction: "IN",
        source: p.paymentType as MoneySource, // SALE_PAYMENT | CREDIT_PAYMENT | ADVANCE_DEPOSIT
        method,
        amount: Math.abs(p.amount),
        party: p.customerName ?? "Walk-in customer",
        description: p.notes || "",
        recordedBy: p.recorderName,
      });
    }
  }

  /* ---- 2. Approved expenses (money out), salary/loans attributed ---- */
  const expConds = [eq(expenses.status, "APPROVED")];
  if (filters.dateFrom) expConds.push(gte(expenses.expenseDate, new Date(`${filters.dateFrom}T00:00:00`)));
  if (filters.dateTo) expConds.push(lte(expenses.expenseDate, new Date(`${filters.dateTo}T23:59:59.999`)));
  const expRows = await db
    .select({
      id: expenses.id,
      reference: expenses.reference,
      amount: expenses.amount,
      description: expenses.description,
      vendor: expenses.vendor,
      paymentMethod: expenses.paymentMethod,
      expenseDate: expenses.expenseDate,
      createdAt: expenses.createdAt,
      categoryName: expenseCategories.name,
      creatorName: users.fullName,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .leftJoin(users, eq(expenses.createdBy, users.id))
    .where(and(...expConds))
    .orderBy(desc(expenses.expenseDate))
    .limit(2000);

  const expIds = expRows.map((e) => e.id);
  const salaryExpIds = new Set<number>();
  const loanExpIds = new Set<number>();
  if (expIds.length) {
    const sp = await db
      .select({ expenseId: salaryPayments.expenseId })
      .from(salaryPayments)
      .where(inArray(salaryPayments.expenseId, expIds));
    for (const r of sp) if (r.expenseId) salaryExpIds.add(r.expenseId);
    const ln = await db
      .select({ expenseId: staffLoans.expenseId })
      .from(staffLoans)
      .where(inArray(staffLoans.expenseId, expIds));
    for (const r of ln) if (r.expenseId) loanExpIds.add(r.expenseId);
  }

  for (const e of expRows) {
    const source: MoneySource = salaryExpIds.has(e.id) ? "SALARY" : loanExpIds.has(e.id) ? "LOAN" : "EXPENSE";
    rows.push({
      id: `exp-${e.id}`,
      date: (e.createdAt ?? new Date(`${isoDay(e.expenseDate)}T00:00:00`)).toISOString(),
      reference: e.reference,
      direction: "OUT",
      source,
      method: (e.paymentMethod ?? "CASH") as MoneyMethod,
      amount: e.amount,
      party: e.vendor,
      description: source === "EXPENSE" ? `${e.categoryName ?? "Expense"} — ${e.description}` : e.description,
      recordedBy: e.creatorName,
    });
  }

  /* ---- 3. Manual "other" movements ---- */
  const mmConds = [];
  if (filters.dateFrom) mmConds.push(gte(moneyMovements.movementDate, new Date(`${filters.dateFrom}T00:00:00`)));
  if (filters.dateTo) mmConds.push(lte(moneyMovements.movementDate, new Date(`${filters.dateTo}T23:59:59.999`)));
  const mmRows = await db
    .select({
      id: moneyMovements.id,
      reference: moneyMovements.reference,
      direction: moneyMovements.direction,
      method: moneyMovements.method,
      label: moneyMovements.label,
      amount: moneyMovements.amount,
      description: moneyMovements.description,
      movementDate: moneyMovements.movementDate,
      createdAt: moneyMovements.createdAt,
      creatorName: users.fullName,
    })
    .from(moneyMovements)
    .leftJoin(users, eq(moneyMovements.createdBy, users.id))
    .where(mmConds.length ? and(...mmConds) : undefined)
    .orderBy(desc(moneyMovements.movementDate))
    .limit(1000);

  for (const m of mmRows) {
    rows.push({
      id: `mm-${m.id}`,
      date: (m.createdAt ?? new Date(`${isoDay(m.movementDate)}T00:00:00`)).toISOString(),
      reference: m.reference,
      direction: m.direction,
      source: m.direction === "IN" ? "OTHER_IN" : "OTHER_OUT",
      method: m.method,
      amount: m.amount,
      party: null,
      description: m.description ? `${m.label} — ${m.description}` : m.label,
      recordedBy: m.creatorName,
    });
  }

  /* ---- apply in-memory filters (direction/method/source/search) ---- */
  const q = filters.search?.trim().toLowerCase();
  return rows
    .filter((r) => (filters.direction ? r.direction === filters.direction : true))
    .filter((r) => (filters.method ? r.method === filters.method : true))
    .filter((r) => (filters.source ? r.source === filters.source : true))
    .filter((r) =>
      q
        ? [r.reference, r.party ?? "", r.description, r.recordedBy ?? ""].some((s) => s.toLowerCase().includes(q))
        : true,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function summarizeMovements(rows: MoneyMovementRow[]): MoneySummary {
  const methods = METHODS.map((m) => ({ method: m, in: 0, out: 0, balance: 0 }));
  const sourceMap = new Map<string, { source: MoneySource; direction: MoneyDirection; total: number; count: number }>();
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    const bucket = methods.find((m) => m.method === r.method)!;
    if (r.direction === "IN") {
      bucket.in += r.amount;
      totalIn += r.amount;
    } else {
      bucket.out += r.amount;
      totalOut += r.amount;
    }
    const key = r.source;
    const s = sourceMap.get(key) ?? { source: r.source, direction: r.direction, total: 0, count: 0 };
    s.total += r.amount;
    s.count += 1;
    sourceMap.set(key, s);
  }
  for (const m of methods) m.balance = m.in - m.out;
  const order: MoneySource[] = [
    "SALE_PAYMENT",
    "CREDIT_PAYMENT",
    "ADVANCE_DEPOSIT",
    "OTHER_IN",
    "EXPENSE",
    "SALARY",
    "LOAN",
    "DEPOSIT_REFUND",
    "OTHER_OUT",
  ];
  return {
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    count: rows.length,
    methods,
    sources: [...sourceMap.values()].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source)),
  };
}
