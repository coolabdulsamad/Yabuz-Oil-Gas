import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  expenseCategories,
  expenses,
  salaryConfigs,
  staffLoanRepayments,
  staffLoans,
  users,
} from "@db/schema";
import { LOAN_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — staff loans router (Admin & Super Admin only)
 * A staff member borrows from the company; repayment is deducted from
 * their salary over the configured term (e.g. from this month across the
 * next 3 salaries). Disbursement is auto-recorded as an approved expense
 * under "Staff Loans"; deductions happen automatically inside payroll
 * (salary.router pay), each logged in staff_loan_repayments.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const LOAN_EXPENSE_CATEGORY = "Staff Loans";

async function loanCategoryId(tx: Tx): Promise<number> {
  const [existing] = await tx
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.name, LOAN_EXPENSE_CATEGORY))
    .limit(1);
  if (existing) return existing.id;
  const [{ id }] = await tx
    .insert(expenseCategories)
    .values({ name: LOAN_EXPENSE_CATEGORY, description: "Money lent to staff, recovered via salary deductions (auto-created by loans)." })
    .$returningId();
  return id;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
}

/** Preview schedule: termMonths rows of monthlyDeduction starting at start period. */
export function loanSchedule(amount: number, termMonths: number, monthlyDeduction: number, startYear: number, startMonth: number) {
  const rows: { year: number; month: number; amount: number }[] = [];
  let left = amount;
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < termMonths && left > 0; i++) {
    const inst = Number(Math.min(monthlyDeduction, left).toFixed(2));
    rows.push({ year: y, month: m, amount: inst });
    left = Number((left - inst).toFixed(2));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return rows;
}

export const loansRouter = createRouter({
  list: permissionProcedure("loans.view")
    .input(
      z
        .object({
          status: z.enum(LOAN_STATUSES).optional(),
          userId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.status) conds.push(eq(staffLoans.status, input.status));
      if (input?.userId) conds.push(eq(staffLoans.userId, input.userId));
      const rows = await db
        .select({
          loan: staffLoans,
          staffName: users.fullName,
          staffCode: users.staffCode,
        })
        .from(staffLoans)
        .innerJoin(users, eq(users.id, staffLoans.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(staffLoans.createdAt))
        .limit(300);
      return rows.map((r) => ({ ...r.loan, staffName: r.staffName, staffCode: r.staffCode }));
    }),

  getById: permissionProcedure("loans.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [loan] = await db.select().from(staffLoans).where(eq(staffLoans.id, input.id)).limit(1);
      if (!loan) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found." });
      const [staff] = await db.select().from(users).where(eq(users.id, loan.userId)).limit(1);
      const repayments = await db
        .select()
        .from(staffLoanRepayments)
        .where(eq(staffLoanRepayments.loanId, loan.id))
        .orderBy(desc(staffLoanRepayments.createdAt));
      const approver = loan.approvedBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, loan.approvedBy)).limit(1))[0]
        : null;
      const schedule = loanSchedule(loan.amount, loan.termMonths, loan.monthlyDeduction, loan.startYear, loan.startMonth)
        .map((s) => ({ ...s, label: monthLabel(s.year, s.month), paid: repayments.some((r) => r.periodYear === s.year && r.periodMonth === s.month) }));
      return { loan, staff, repayments, schedule, approverName: approver?.fullName ?? null };
    }),

  create: permissionProcedure("loans.manage")
    .input(
      z.object({
        userId: z.number().int().positive(),
        amount: z.number().positive("Loan amount must be greater than zero"),
        termMonths: z.number().int().min(1, "Term must be at least 1 month").max(36, "Term can't exceed 36 months"),
        startYear: z.number().int().min(2020).max(2100),
        startMonth: z.number().int().min(1).max(12),
        reason: z.string().trim().min(3, "Give a reason for the loan.").max(500),
        notes: z.string().trim().max(2000).optional(),
        /** Approve & disburse immediately (default true — admins act directly). */
        approveNow: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [staff] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!staff) throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      if (staff.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${staff.fullName} is suspended — loans can only go to active staff.` });
      }

      // Sanity: the monthly deduction shouldn't swallow the whole net salary.
      const [cfg] = await db.select().from(salaryConfigs).where(eq(salaryConfigs.userId, input.userId)).limit(1);
      const monthlyDeduction = Number((input.amount / input.termMonths).toFixed(2));
      if (cfg && cfg.isActive) {
        const roughNet =
          cfg.basicSalary + cfg.housingAllowance + cfg.transportAllowance + cfg.mealAllowance + cfg.otherAllowance;
        if (monthlyDeduction > roughNet * 0.5) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `The monthly deduction (₦${monthlyDeduction.toLocaleString()}) is more than half of ${staff.fullName}'s gross pay (≈₦${roughNet.toLocaleString()}). Increase the term or reduce the amount.`,
          });
        }
      }

      // No overlapping active/pending loans for the same staff.
      const open = await db
        .select({ id: staffLoans.id, reference: staffLoans.reference, status: staffLoans.status })
        .from(staffLoans)
        .where(and(eq(staffLoans.userId, input.userId), eq(staffLoans.status, "ACTIVE")));
      if (open.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${staff.fullName} already has an active loan (${open[0].reference}) — it must be paid off before a new one.` });
      }

      const result = await db.transaction(async (tx) => {
        const [{ id: loanId }] = await tx
          .insert(staffLoans)
          .values({
            reference: "PENDING",
            userId: input.userId,
            amount: input.amount,
            termMonths: input.termMonths,
            monthlyDeduction,
            remainingBalance: input.amount,
            startYear: input.startYear,
            startMonth: input.startMonth,
            status: "PENDING",
            reason: input.reason,
            notes: input.notes || null,
            createdBy: ctx.user.id,
          })
          .$returningId();
        const reference = `LN-${String(loanId).padStart(6, "0")}`;
        await tx.update(staffLoans).set({ reference }).where(eq(staffLoans.id, loanId));

        if (input.approveNow) {
          const categoryId = await loanCategoryId(tx);
          const [{ id: expenseId }] = await tx
            .insert(expenses)
            .values({
              reference: "PENDING",
              categoryId,
              amount: input.amount,
              description: `Staff loan ${reference} — ${staff.fullName} · repay ₦${monthlyDeduction.toLocaleString()}/month × ${input.termMonths} from ${monthLabel(input.startYear, input.startMonth)}`,
              vendor: staff.fullName,
              expenseDate: new Date(),
              status: "APPROVED",
              createdBy: ctx.user.id,
              approvedBy: ctx.user.id,
              approvedAt: new Date(),
            })
            .$returningId();
          const expenseRef = `EXP-${String(expenseId).padStart(6, "0")}`;
          await tx.update(expenses).set({ reference: expenseRef }).where(eq(expenses.id, expenseId));
          await tx
            .update(staffLoans)
            .set({ status: "ACTIVE", approvedBy: ctx.user.id, approvedAt: new Date(), expenseId })
            .where(eq(staffLoans.id, loanId));
          return { loanId, reference, status: "ACTIVE" as const, expenseRef };
        }
        return { loanId, reference, status: "PENDING" as const };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: result.status === "ACTIVE" ? "loan.disbursed" : "loan.created",
        entityType: "STAFF_LOAN",
        entityId: result.loanId,
        description: `${result.status === "ACTIVE" ? "Disbursed" : "Created"} loan ${result.reference} — ${staff.fullName} · ₦${input.amount.toLocaleString()} over ${input.termMonths} month(s) (${monthlyDeduction.toLocaleString()}/month from ${monthLabel(input.startYear, input.startMonth)})${result.expenseRef ? ` → expense ${result.expenseRef}` : ""}.`,
        afterData: { reference: result.reference, userId: input.userId, amount: input.amount, termMonths: input.termMonths, monthlyDeduction, start: `${input.startYear}-${input.startMonth}` },
        ...requestMeta(ctx.req),
      });
      return result;
    }),

  /** Approve & disburse a PENDING loan. */
  approve: permissionProcedure("loans.manage")
    .input(z.object({ loanId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [loan] = await db.select().from(staffLoans).where(eq(staffLoans.id, input.loanId)).limit(1);
      if (!loan) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found." });
      if (loan.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This loan is already ${loan.status.toLowerCase()}.` });
      }
      const [staff] = await db.select().from(users).where(eq(users.id, loan.userId)).limit(1);
      const result = await db.transaction(async (tx) => {
        const categoryId = await loanCategoryId(tx);
        const [{ id: expenseId }] = await tx
          .insert(expenses)
          .values({
            reference: "PENDING",
            categoryId,
            amount: loan.amount,
            description: `Staff loan ${loan.reference} — ${staff?.fullName ?? ""} · repay ₦${loan.monthlyDeduction.toLocaleString()}/month × ${loan.termMonths} from ${monthLabel(loan.startYear, loan.startMonth)}`,
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
        await tx
          .update(staffLoans)
          .set({ status: "ACTIVE", approvedBy: ctx.user.id, approvedAt: new Date(), expenseId })
          .where(eq(staffLoans.id, loan.id));
        return { expenseRef };
      });
      await logAudit({
        actorId: ctx.user.id,
        action: "loan.disbursed",
        entityType: "STAFF_LOAN",
        entityId: loan.id,
        description: `Disbursed loan ${loan.reference} — ${staff?.fullName ?? ""} · ₦${loan.amount.toLocaleString()} → expense ${result.expenseRef}.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, expenseReference: result.expenseRef };
    }),

  reject: permissionProcedure("loans.manage")
    .input(z.object({ loanId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [loan] = await db.select().from(staffLoans).where(eq(staffLoans.id, input.loanId)).limit(1);
      if (!loan) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found." });
      if (loan.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending loan can be rejected." });
      }
      await db.update(staffLoans).set({ status: "REJECTED", rejectedReason: input.reason }).where(eq(staffLoans.id, loan.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "loan.rejected",
        entityType: "STAFF_LOAN",
        entityId: loan.id,
        description: `Rejected loan ${loan.reference} — ${input.reason}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),

  /** Record a manual repayment (staff pays cash/transfer outside payroll). */
  recordRepayment: permissionProcedure("loans.manage")
    .input(
      z.object({
        loanId: z.number().int().positive(),
        amount: z.number().positive(),
        periodYear: z.number().int().min(2020).max(2100),
        periodMonth: z.number().int().min(1).max(12),
        note: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [loan] = await db.select().from(staffLoans).where(eq(staffLoans.id, input.loanId)).limit(1);
      if (!loan) throw new TRPCError({ code: "NOT_FOUND", message: "Loan not found." });
      if (loan.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Repayments can only go to an active loan." });
      }
      if (input.amount > loan.remainingBalance) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only ₦${loan.remainingBalance.toLocaleString()} is left on this loan.` });
      }
      await db.transaction(async (tx) => {
        await tx.insert(staffLoanRepayments).values({
          loanId: loan.id,
          salaryPaymentId: null,
          amount: input.amount,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          note: input.note || "Manual repayment",
          createdBy: ctx.user.id,
        });
        const amountRepaid = Number((loan.amountRepaid + input.amount).toFixed(2));
        const remainingBalance = Number((loan.amount - amountRepaid).toFixed(2));
        await tx
          .update(staffLoans)
          .set({ amountRepaid, remainingBalance, status: remainingBalance <= 0 ? "PAID_OFF" : "ACTIVE" })
          .where(eq(staffLoans.id, loan.id));
      });
      await logAudit({
        actorId: ctx.user.id,
        action: "loan.repayment",
        entityType: "STAFF_LOAN",
        entityId: loan.id,
        description: `Recorded ₦${input.amount.toLocaleString()} repayment on loan ${loan.reference}${input.amount >= loan.remainingBalance ? " — loan fully paid off" : ""}.`,
        afterData: { amount: input.amount, period: `${input.periodYear}-${input.periodMonth}` },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),
});
