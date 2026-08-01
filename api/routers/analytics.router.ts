import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { customers, expenses, expenseCategories, payments, saleItems, sales, users } from "@db/schema";

/**
 * YABUZ OIL & GAS — analytics router
 * Chart-ready aggregations for the analytics dashboards (analytics.view).
 * Everything is date-ranged; the default window is the last 30 days.
 */

const rangeInput = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .optional();

function bounds(input?: { dateFrom?: string; dateTo?: string }) {
  const to = input?.dateTo ? new Date(`${input.dateTo}T23:59:59.999`) : new Date();
  // Default window: the last 30 UTC days (matches the trend series).
  const toUtcDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const from = input?.dateFrom
    ? new Date(`${input.dateFrom}T00:00:00`)
    : new Date(toUtcDay - 29 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const analyticsRouter = createRouter({
  /* ------------------------- KPI OVERVIEW + PREVIOUS ------------------------ */

  overview: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);
      const span = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - span - 1000);
      const prevTo = new Date(from.getTime() - 1000);

      async function windowStats(f: Date, t: Date) {
        const [rev] = await getDb()
          .select({
            revenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
            collected: sql<number>`COALESCE(SUM(${sales.amountPaid}), 0)`,
            salesCount: sql<number>`COUNT(*)`,
          })
          .from(sales)
          .where(and(eq(sales.status, "COMPLETED"), gte(sales.createdAt, f), lte(sales.createdAt, t)));
        const [cogs] = await getDb()
          .select({ cost: sql<number>`COALESCE(SUM(${saleItems.packsDeducted} * ${saleItems.costPrice}), 0)` })
          .from(saleItems)
          .innerJoin(sales, eq(saleItems.saleId, sales.id))
          .where(and(eq(sales.status, "COMPLETED"), gte(sales.createdAt, f), lte(sales.createdAt, t)));
        const [exp] = await getDb()
          .select({ amount: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` })
          .from(expenses)
          .where(and(eq(expenses.status, "APPROVED"), gte(expenses.expenseDate, f), lte(expenses.expenseDate, t)));
        const [pay] = await getDb()
          .select({ amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
          .from(payments)
          .where(and(eq(payments.status, "CONFIRMED"), sql`${payments.paymentType} <> 'DEPOSIT_REFUND'`, gte(payments.confirmedAt, f), lte(payments.confirmedAt, t)));
        const revenue = Number(rev?.revenue ?? 0);
        return {
          revenue,
          collected: Number(pay?.amount ?? 0),
          cogs: Number(cogs?.cost ?? 0),
          grossMargin: revenue - Number(cogs?.cost ?? 0),
          expenses: Number(exp?.amount ?? 0),
          salesCount: Number(rev?.salesCount ?? 0),
          avgSale: Number(rev?.salesCount ?? 0) > 0 ? revenue / Number(rev?.salesCount ?? 1) : 0,
        };
      }

      const current = await windowStats(from, to);
      const previous = await windowStats(prevFrom, prevTo);

      const [wallets] = await db
        .select({
          outstanding: sql<number>`COALESCE(SUM(${customers.creditOutstanding}), 0)`,
          deposits: sql<number>`COALESCE(SUM(${customers.depositBalance}), 0)`,
        })
        .from(customers)
        .where(eq(customers.status, "ACTIVE"));

      return {
        current,
        previous,
        outstanding: Number(wallets?.outstanding ?? 0),
        depositsHeld: Number(wallets?.deposits ?? 0),
        from: from.toISOString(),
        to: to.toISOString(),
      };
    }),

  /* ------------------------------ DAILY TREND ------------------------------- */

  revenueTrend: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);

      const salesRows = await db
        .select({
          day: sql<string>`DATE_FORMAT(${sales.createdAt}, '%Y-%m-%d') AS day`,
          revenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
        })
        .from(sales)
        .where(and(eq(sales.status, "COMPLETED"), gte(sales.createdAt, from), lte(sales.createdAt, to)))
        .groupBy(sql`day`);

      const payRows = await db
        .select({
          day: sql<string>`DATE_FORMAT(${payments.confirmedAt}, '%Y-%m-%d') AS day`,
          collected: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(and(eq(payments.status, "CONFIRMED"), sql`${payments.paymentType} <> 'DEPOSIT_REFUND'`, gte(payments.confirmedAt, from), lte(payments.confirmedAt, to)))
        .groupBy(sql`day`);

      const expRows = await db
        .select({
          day: sql<string>`DATE_FORMAT(${expenses.expenseDate}, '%Y-%m-%d') AS day`,
          expenses: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(and(eq(expenses.status, "APPROVED"), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)))
        .groupBy(sql`day`);

      // Zero-fill the series on UTC days — matches the DATE_FORMAT keys above.
      const byDay = new Map<string, { day: string; revenue: number; collected: number; expenses: number }>();
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      const endKey = to.toISOString().slice(0, 10);
      for (;;) {
        const key = cursor.toISOString().slice(0, 10);
        byDay.set(key, { day: key, revenue: 0, collected: 0, expenses: 0 });
        if (key >= endKey) break;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      for (const r of salesRows) {
        const key = String(r.day).slice(0, 10);
        const e = byDay.get(key);
        if (e) e.revenue = Number(r.revenue);
      }
      for (const r of payRows) {
        const key = String(r.day).slice(0, 10);
        const e = byDay.get(key);
        if (e) e.collected = Number(r.collected);
      }
      for (const r of expRows) {
        const key = String(r.day).slice(0, 10);
        const e = byDay.get(key);
        if (e) e.expenses = Number(r.expenses);
      }
      return [...byDay.values()];
    }),

  /* ------------------------------ TOP PRODUCTS ------------------------------ */

  topProducts: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);
      const rows = await db
        .select({
          productName: saleItems.productName,
          packs: sql<number>`COALESCE(SUM(${saleItems.packsDeducted}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${saleItems.lineTotal}), 0)`,
          cost: sql<number>`COALESCE(SUM(${saleItems.packsDeducted} * ${saleItems.costPrice}), 0)`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(eq(sales.status, "COMPLETED"), gte(sales.createdAt, from), lte(sales.createdAt, to)))
        .groupBy(saleItems.productId, saleItems.productName)
        .orderBy(desc(sql`SUM(${saleItems.lineTotal})`))
        .limit(8);
      return rows.map((r) => ({ ...r, packs: Number(r.packs), revenue: Number(r.revenue), cost: Number(r.cost), margin: Number(r.revenue) - Number(r.cost) }));
    }),

  /* ------------------------------- SALES BY REP ----------------------------- */

  salesByRep: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);
      const rows = await db
        .select({
          repName: users.fullName,
          salesCount: sql<number>`COUNT(*)`,
          revenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
        })
        .from(sales)
        .leftJoin(users, eq(sales.salesRepId, users.id))
        .where(and(eq(sales.status, "COMPLETED"), gte(sales.createdAt, from), lte(sales.createdAt, to)))
        .groupBy(sales.salesRepId, users.fullName)
        .orderBy(desc(sql`SUM(${sales.grandTotal})`));
      return rows.map((r) => ({ repName: r.repName ?? "—", salesCount: Number(r.salesCount), revenue: Number(r.revenue) }));
    }),

  /* --------------------------- PAYMENT METHOD MIX --------------------------- */

  paymentMethodMix: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);
      const rows = await db
        .select({
          method: payments.method,
          count: sql<number>`COUNT(*)`,
          amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(and(eq(payments.status, "CONFIRMED"), sql`${payments.paymentType} <> 'DEPOSIT_REFUND'`, gte(payments.confirmedAt, from), lte(payments.confirmedAt, to)))
        .groupBy(payments.method);
      return rows.map((r) => ({ method: r.method, count: Number(r.count), amount: Number(r.amount) }));
    }),

  /* ----------------------------- EXPENSE MIX -------------------------------- */

  expenseMix: permissionProcedure("analytics.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const { from, to } = bounds(input ?? undefined);
      const rows = await db
        .select({
          category: expenseCategories.name,
          amount: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
        .where(and(eq(expenses.status, "APPROVED"), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)))
        .groupBy(expenses.categoryId, expenseCategories.name)
        .orderBy(desc(sql`SUM(${expenses.amount})`));
      return rows.map((r) => ({ category: r.category ?? "—", amount: Number(r.amount), count: Number(r.count) }));
    }),

  /* ------------------------------- TOP DEBTORS ------------------------------ */

  topDebtors: permissionProcedure("analytics.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        fullName: customers.fullName,
        code: customers.code,
        creditOutstanding: customers.creditOutstanding,
        creditLimit: customers.creditLimit,
      })
      .from(customers)
      .where(and(eq(customers.status, "ACTIVE"), sql`${customers.creditOutstanding} > 0`))
      .orderBy(desc(customers.creditOutstanding))
      .limit(8);
    return rows.map((r) => ({
      ...r,
      creditOutstanding: Number(r.creditOutstanding),
      creditLimit: Number(r.creditLimit),
    }));
  }),
});
