import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  expenseCategories,
  expenses,
  salaryConfigs,
  salaryPayments,
  staffLoanRepayments,
  staffLoans,
  users,
} from "@db/schema";
import { SALARY_PAYMENT_METHODS, SALARY_PAYMENT_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — payroll router (Admin & Super Admin only)
 * Salary configuration per staff (basic, allowances, bonus, tax/pension/
 * VAT/other deductions), monthly payroll generation with full payslip
 * breakdown, and payment recording. Every PAID salary auto-creates an
 * approved company expense under "Salaries & Wages" so expenses, reports
 * and P&L pick it up automatically. Active staff loans are deducted from
 * net pay automatically (oldest loan first, from its configured start
 * period, capped at the remaining balance).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const SALARY_EXPENSE_CATEGORY = "Salaries & Wages";

/** Get (or lazily create) the salary expense category. */
async function salaryCategoryId(tx: Tx): Promise<number> {
  const [existing] = await tx
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.name, SALARY_EXPENSE_CATEGORY))
    .limit(1);
  if (existing) return existing.id;
  const [{ id }] = await tx
    .insert(expenseCategories)
    .values({ name: SALARY_EXPENSE_CATEGORY, description: "Staff salaries, allowances and bonuses (auto-created by payroll)." })
    .$returningId();
  return id;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
}

function periodKey(year: number, month: number) {
  return year * 100 + month;
}

/** Active loans due for deduction in a period, oldest first. */
async function dueLoans(db: Db | Tx, userId: number, year: number, month: number) {
  const rows = await db
    .select()
    .from(staffLoans)
    .where(and(eq(staffLoans.userId, userId), eq(staffLoans.status, "ACTIVE")))
    .orderBy(asc(staffLoans.id));
  const pk = periodKey(year, month);
  return rows.filter((l) => periodKey(l.startYear, l.startMonth) <= pk && l.remainingBalance > 0);
}

/** Compute the payroll breakdown for a config (+ loan deductions) for a period. */
function computePayroll(
  cfg: typeof salaryConfigs.$inferSelect,
  loanDeduction: number,
  extraBonus: number,
) {
  const r2 = (n: number) => Number(n.toFixed(2));
  const basic = r2(cfg.basicSalary);
  const housing = r2(cfg.housingAllowance);
  const transport = r2(cfg.transportAllowance);
  const meal = r2(cfg.mealAllowance);
  const otherAllowance = r2(cfg.otherAllowance);
  const bonus = r2(cfg.monthlyBonus + extraBonus);
  const grossPay = r2(basic + housing + transport + meal + otherAllowance + bonus);
  const taxAmount = r2((grossPay * cfg.taxPercent) / 100);
  const pensionAmount = r2((basic * cfg.pensionPercent) / 100);
  const vatAmount = r2((grossPay * cfg.vatPercent) / 100);
  const otherDeduction = r2(cfg.otherDeduction);
  const totalDeductions = r2(taxAmount + pensionAmount + vatAmount + otherDeduction + loanDeduction);
  const netPay = r2(grossPay - totalDeductions);
  return {
    basic, housing, transport, meal, otherAllowance, bonus,
    grossPay, taxAmount, pensionAmount, vatAmount, otherDeduction,
    loanDeduction: r2(loanDeduction), totalDeductions, netPay,
  };
}

const configInput = z.object({
  userId: z.number().int().positive(),
  basicSalary: z.number().min(0),
  housingAllowance: z.number().min(0).default(0),
  transportAllowance: z.number().min(0).default(0),
  mealAllowance: z.number().min(0).default(0),
  otherAllowance: z.number().min(0).default(0),
  monthlyBonus: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  pensionPercent: z.number().min(0).max(100).default(0),
  vatPercent: z.number().min(0).max(100).default(0),
  otherDeduction: z.number().min(0).default(0),
  deductionNote: z.string().trim().max(255).optional(),
  isActive: z.boolean().default(true),
  effectiveFrom: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const salaryRouter = createRouter({
  /* ------------------------------ CONFIGS ------------------------------ */

  /** Staff list with their salary config (null when not configured yet). */
  listConfigs: permissionProcedure("salary.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        user: {
          id: users.id,
          fullName: users.fullName,
          staffCode: users.staffCode,
          role: users.role,
          status: users.status,
          department: users.department,
          jobTitle: users.jobTitle,
          bankName: users.bankName,
          bankAccountNumber: users.bankAccountNumber,
          bankAccountName: users.bankAccountName,
        },
        config: salaryConfigs,
      })
      .from(users)
      .leftJoin(salaryConfigs, eq(salaryConfigs.userId, users.id))
      .where(eq(users.status, "ACTIVE"))
      .orderBy(users.fullName);
    return rows.map((r) => ({ ...r.user, config: r.config }));
  }),

  saveConfig: permissionProcedure("salary.manage")
    .input(configInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [staff] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!staff) throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      const [existing] = await db.select().from(salaryConfigs).where(eq(salaryConfigs.userId, input.userId)).limit(1);

      const values = {
        basicSalary: input.basicSalary,
        housingAllowance: input.housingAllowance,
        transportAllowance: input.transportAllowance,
        mealAllowance: input.mealAllowance,
        otherAllowance: input.otherAllowance,
        monthlyBonus: input.monthlyBonus,
        taxPercent: input.taxPercent,
        pensionPercent: input.pensionPercent,
        vatPercent: input.vatPercent,
        otherDeduction: input.otherDeduction,
        deductionNote: input.deductionNote || null,
        isActive: input.isActive,
        effectiveFrom: input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00`) : null,
        notes: input.notes || null,
        updatedBy: ctx.user.id,
      };
      if (existing) {
        await db.update(salaryConfigs).set(values).where(eq(salaryConfigs.id, existing.id));
      } else {
        await db.insert(salaryConfigs).values({ ...values, userId: input.userId });
      }
      await logAudit({
        actorId: ctx.user.id,
        action: existing ? "salary.config_updated" : "salary.config_created",
        entityType: "SALARY_CONFIG",
        entityId: input.userId,
        description: `${existing ? "Updated" : "Created"} salary configuration for ${staff.fullName} — basic ₦${input.basicSalary.toLocaleString()}, tax ${input.taxPercent}%, pension ${input.pensionPercent}%, VAT ${input.vatPercent}%.`,
        beforeData: existing
          ? { basicSalary: existing.basicSalary, taxPercent: existing.taxPercent, pensionPercent: existing.pensionPercent, vatPercent: existing.vatPercent, isActive: existing.isActive }
          : null,
        afterData: { basicSalary: input.basicSalary, taxPercent: input.taxPercent, pensionPercent: input.pensionPercent, vatPercent: input.vatPercent, isActive: input.isActive },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),

  /* ------------------------------ PAYROLL ------------------------------ */

  listPayments: permissionProcedure("salary.view")
    .input(
      z
        .object({
          status: z.enum(SALARY_PAYMENT_STATUSES).optional(),
          userId: z.number().int().positive().optional(),
          year: z.number().int().optional(),
          month: z.number().int().min(1).max(12).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.status) conds.push(eq(salaryPayments.status, input.status));
      if (input?.userId) conds.push(eq(salaryPayments.userId, input.userId));
      if (input?.year) conds.push(eq(salaryPayments.periodYear, input.year));
      if (input?.month) conds.push(eq(salaryPayments.periodMonth, input.month));
      const rows = await db
        .select({
          pay: salaryPayments,
          staffName: users.fullName,
          staffCode: users.staffCode,
          role: users.role,
        })
        .from(salaryPayments)
        .innerJoin(users, eq(users.id, salaryPayments.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(salaryPayments.periodYear), desc(salaryPayments.periodMonth), asc(users.fullName))
        .limit(500);
      return rows.map((r) => ({ ...r.pay, staffName: r.staffName, staffCode: r.staffCode, role: r.role }));
    }),

  /** Generate PENDING payroll rows for one month for all staff with active configs. */
  generate: permissionProcedure("salary.manage")
    .input(
      z.object({
        year: z.number().int().min(2020).max(2100),
        month: z.number().int().min(1).max(12),
        /** Optional one-off bonuses: userId → { amount, note }. */
        bonuses: z
          .array(z.object({ userId: z.number().int().positive(), amount: z.number().min(0), note: z.string().trim().max(255).optional() }))
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const configs = await db.select().from(salaryConfigs).where(eq(salaryConfigs.isActive, true));
      if (configs.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No active salary configurations — configure staff salaries first." });
      }
      const existing = await db
        .select({ userId: salaryPayments.userId })
        .from(salaryPayments)
        .where(and(eq(salaryPayments.periodYear, input.year), eq(salaryPayments.periodMonth, input.month)));
      const done = new Set(existing.map((e) => e.userId));
      const bonusBy = new Map(input.bonuses.map((b) => [b.userId, b]));

      const created: { reference: string; staff: string; netPay: number }[] = [];
      await db.transaction(async (tx) => {
        for (const cfg of configs) {
          if (done.has(cfg.userId)) continue;
          const [staff] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, cfg.userId)).limit(1);
          const loans = await dueLoans(tx, cfg.userId, input.year, input.month);
          const loanDeduction = Number(
            loans.reduce((s, l) => s + Math.min(l.monthlyDeduction, l.remainingBalance), 0).toFixed(2),
          );
          const extra = bonusBy.get(cfg.userId);
          const breakdown = computePayroll(cfg, loanDeduction, extra?.amount ?? 0);

          const [{ id: payId }] = await tx
            .insert(salaryPayments)
            .values({
              reference: "PENDING",
              userId: cfg.userId,
              periodYear: input.year,
              periodMonth: input.month,
              ...breakdown,
              bonusNote: extra?.note || null,
              status: "PENDING",
              createdBy: ctx.user.id,
            })
            .$returningId();
          const reference = `SAL-${input.year}${String(input.month).padStart(2, "0")}-${String(payId).padStart(4, "0")}`;
          await tx.update(salaryPayments).set({ reference }).where(eq(salaryPayments.id, payId));
          created.push({ reference, staff: staff?.fullName ?? `#${cfg.userId}`, netPay: breakdown.netPay });
        }
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "salary.generated",
        entityType: "SALARY_PAYMENT",
        description: `Generated payroll for ${monthLabel(input.year, input.month)} — ${created.length} payslip(s), total net ₦${created.reduce((s, c) => s + c.netPay, 0).toLocaleString()}.`,
        afterData: { year: input.year, month: input.month, count: created.length, references: created.map((c) => c.reference) },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, created, skipped: done.size };
    }),

  /** Record payment of a PENDING payslip — auto-creates the expense and loan deductions. */
  pay: permissionProcedure("salary.manage")
    .input(
      z.object({
        paymentId: z.number().int().positive(),
        paymentMethod: z.enum(SALARY_PAYMENT_METHODS),
        paymentReference: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [pay] = await db.select().from(salaryPayments).where(eq(salaryPayments.id, input.paymentId)).limit(1);
      if (!pay) throw new TRPCError({ code: "NOT_FOUND", message: "Payslip not found." });
      if (pay.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This payslip is already ${pay.status.toLowerCase()}.` });
      }
      const [staff] = await db.select().from(users).where(eq(users.id, pay.userId)).limit(1);

      const result = await db.transaction(async (tx) => {
        // 1. Auto-create the company expense (approved — admins pay directly).
        const categoryId = await salaryCategoryId(tx);
        const [{ id: expenseId }] = await tx
          .insert(expenses)
          .values({
            reference: "PENDING",
            categoryId,
            amount: pay.netPay,
            description: `Salary ${monthLabel(pay.periodYear, pay.periodMonth)} — ${staff?.fullName ?? `#${pay.userId}`} (${pay.reference})${pay.loanDeduction > 0 ? ` · incl. ₦${pay.loanDeduction.toLocaleString()} loan deduction` : ""}`,
            vendor: staff?.fullName ?? null,
            expenseDate: new Date(),
            status: "APPROVED",
            createdBy: ctx.user.id,
            approvedBy: ctx.user.id,
            approvedAt: new Date(),
          })
          .$returningId();
        const expenseRef = `EXP-${String(expenseId).padStart(6, "0")}`;
        await tx.update(expenses).set({ reference: expenseRef }).where(eq(expenses.id, expenseId));

        // 2. Apply loan deductions, oldest loan first, capped at remaining balance.
        let remaining = pay.loanDeduction;
        if (remaining > 0) {
          const loans = await dueLoans(tx, pay.userId, pay.periodYear, pay.periodMonth);
          for (const loan of loans) {
            if (remaining <= 0) break;
            const installment = Number(Math.min(loan.monthlyDeduction, loan.remainingBalance, remaining).toFixed(2));
            if (installment <= 0) continue;
            await tx.insert(staffLoanRepayments).values({
              loanId: loan.id,
              salaryPaymentId: pay.id,
              amount: installment,
              periodYear: pay.periodYear,
              periodMonth: pay.periodMonth,
              note: `Deducted from ${pay.reference}`,
              createdBy: ctx.user.id,
            });
            const amountRepaid = Number((loan.amountRepaid + installment).toFixed(2));
            const remainingBalance = Number((loan.amount - amountRepaid).toFixed(2));
            await tx
              .update(staffLoans)
              .set({ amountRepaid, remainingBalance, status: remainingBalance <= 0 ? "PAID_OFF" : "ACTIVE" })
              .where(eq(staffLoans.id, loan.id));
            remaining = Number((remaining - installment).toFixed(2));
          }
        }

        // 3. Mark the payslip paid.
        await tx
          .update(salaryPayments)
          .set({
            status: "PAID",
            paymentMethod: input.paymentMethod,
            paymentReference: input.paymentReference || null,
            paidAt: new Date(),
            paidBy: ctx.user.id,
            expenseId,
            notes: input.notes ? `${pay.notes ? `${pay.notes}\n` : ""}${input.notes}` : pay.notes,
          })
          .where(eq(salaryPayments.id, pay.id));
        return { expenseRef };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "salary.paid",
        entityType: "SALARY_PAYMENT",
        entityId: pay.id,
        description: `Paid salary ${pay.reference} — ${staff?.fullName ?? ""} net ₦${pay.netPay.toLocaleString()} via ${input.paymentMethod.toLowerCase().replace("_", " ")}${input.paymentReference ? ` (ref ${input.paymentReference})` : ""} → expense ${result.expenseRef}.`,
        beforeData: { status: "PENDING" },
        afterData: { status: "PAID", netPay: pay.netPay, paymentMethod: input.paymentMethod, expense: result.expenseRef },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, expenseReference: result.expenseRef };
    }),

  /** Cancel a PENDING payslip (e.g. generated by mistake). */
  cancel: permissionProcedure("salary.manage")
    .input(z.object({ paymentId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [pay] = await db.select().from(salaryPayments).where(eq(salaryPayments.id, input.paymentId)).limit(1);
      if (!pay) throw new TRPCError({ code: "NOT_FOUND", message: "Payslip not found." });
      if (pay.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending payslip can be cancelled." });
      }
      await db.update(salaryPayments).set({ status: "CANCELLED", notes: `Cancelled: ${input.reason}` }).where(eq(salaryPayments.id, pay.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "salary.cancelled",
        entityType: "SALARY_PAYMENT",
        entityId: pay.id,
        description: `Cancelled payslip ${pay.reference} — ${input.reason}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),

  /** Full payslip detail for viewing/printing. */
  getPayslip: permissionProcedure("salary.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [pay] = await db.select().from(salaryPayments).where(eq(salaryPayments.id, input.id)).limit(1);
      if (!pay) throw new TRPCError({ code: "NOT_FOUND", message: "Payslip not found." });
      const [staff] = await db.select().from(users).where(eq(users.id, pay.userId)).limit(1);
      const paidBy = pay.paidBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, pay.paidBy)).limit(1))[0]
        : null;
      const loanRows = await db
        .select({ repayment: staffLoanRepayments, loanRef: staffLoans.reference })
        .from(staffLoanRepayments)
        .innerJoin(staffLoans, eq(staffLoans.id, staffLoanRepayments.loanId))
        .where(eq(staffLoanRepayments.salaryPaymentId, pay.id));
      return {
        pay,
        staff: staff
          ? {
              fullName: staff.fullName,
              staffCode: staff.staffCode,
              role: staff.role,
              department: staff.department,
              jobTitle: staff.jobTitle,
              bankName: staff.bankName,
              bankAccountNumber: staff.bankAccountNumber,
              bankAccountName: staff.bankAccountName,
              dateEmployed: staff.dateEmployed,
            }
          : null,
        paidByName: paidBy?.fullName ?? null,
        loanDeductions: loanRows.map((r) => ({ ...r.repayment, loanRef: r.loanRef })),
      };
    }),
});
