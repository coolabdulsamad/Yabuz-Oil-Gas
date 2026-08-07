import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { approvalRequests, approvalRequestSteps, expenseCategories, expenses, users } from "@db/schema";
import { EXPENSE_STATUSES, MONEY_METHODS } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { getFlowSteps, submitApproval } from "../services/approvals.service";

/**
 * YABUZ OIL & GAS — expenses router
 * Company spending with category, vendor, date and receipt proof.
 * New expenses ride the EXPENSE approval chain (default: manager → admin).
 */

const expenseInput = z.object({
  categoryId: z.number().int().positive(),
  amount: z.number().positive("Amount must be greater than zero"),
  description: z.string().trim().min(3, "Describe the expense").max(2000),
  vendor: z.string().trim().max(160).optional(),
  paymentMethod: z.enum(MONEY_METHODS).default("CASH"),
  expenseDate: z.string().min(8, "Pick the expense date"),
  receiptUrl: z.string().url().max(500).optional(),
  receiptPublicId: z.string().max(255).optional(),
});

export const expensesRouter = createRouter({
  /* ------------------------------- CATEGORIES ------------------------------ */

  categories: permissionProcedure("expenses.view").query(async () => {
    const db = getDb();
    const rows = await db.select().from(expenseCategories).orderBy(asc(expenseCategories.name));
    const counts = await db.select({ categoryId: expenses.categoryId }).from(expenses);
    const countBy = new Map<number, number>();
    for (const c of counts) countBy.set(c.categoryId, (countBy.get(c.categoryId) ?? 0) + 1);
    return rows.map((r) => ({ ...r, expenseCount: countBy.get(r.id) ?? 0 }));
  }),

  saveCategory: permissionProcedure("expenses.manage_categories")
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(2000).optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.id) {
        const [existing] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, input.id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found." });
        await db
          .update(expenseCategories)
          .set({ name: input.name, description: input.description || null, isActive: input.isActive })
          .where(eq(expenseCategories.id, input.id));
        await logAudit({
          actorId: ctx.user.id,
          action: "expense_category.updated",
          entityType: "EXPENSE",
          entityId: input.id,
          description: `Updated expense category "${input.name}".`,
          beforeData: { name: existing.name, isActive: existing.isActive },
          afterData: { name: input.name, isActive: input.isActive },
          ...requestMeta(ctx.req),
        });
        return { ok: true as const, id: input.id };
      }
      const dup = await db.select().from(expenseCategories).where(eq(expenseCategories.name, input.name)).limit(1);
      if (dup.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A category with this name already exists." });
      const [{ id }] = await db
        .insert(expenseCategories)
        .values({ name: input.name, description: input.description || null, isActive: input.isActive })
        .$returningId();
      await logAudit({
        actorId: ctx.user.id,
        action: "expense_category.created",
        entityType: "EXPENSE",
        entityId: id,
        description: `Created expense category "${input.name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, id };
    }),

  /* -------------------------------- EXPENSES ------------------------------- */

  list: permissionProcedure("expenses.view")
    .input(
      z
        .object({
          status: z.enum(EXPENSE_STATUSES).optional(),
          categoryId: z.number().int().positive().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.status) conds.push(eq(expenses.status, input.status));
      if (input?.categoryId) conds.push(eq(expenses.categoryId, input.categoryId));
      if (input?.dateFrom) conds.push(gte(expenses.expenseDate, new Date(`${input.dateFrom}T00:00:00`)));
      if (input?.dateTo) conds.push(lte(expenses.expenseDate, new Date(`${input.dateTo}T23:59:59`)));
      const rows = await db
        .select({ expense: expenses, categoryName: expenseCategories.name, creatorName: users.fullName })
        .from(expenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .innerJoin(users, eq(users.id, expenses.createdBy))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
        .limit(300);
      return rows.map((r) => ({ ...r.expense, categoryName: r.categoryName, creatorName: r.creatorName }));
    }),

  create: permissionProcedure("expenses.create")
    .input(expenseInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [category] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId)).limit(1);
      if (!category || !category.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an active expense category." });
      }
      const date = new Date(`${input.expenseDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid expense date." });

      const result = await db.transaction(async (tx) => {
        const [{ id: expenseId }] = await tx
          .insert(expenses)
          .values({
            reference: "PENDING",
            categoryId: input.categoryId,
            amount: input.amount,
            description: input.description,
            vendor: input.vendor || null,
            paymentMethod: input.paymentMethod,
            expenseDate: date,
            receiptUrl: input.receiptUrl ?? null,
            receiptPublicId: input.receiptPublicId ?? null,
            status: "PENDING",
            createdBy: ctx.user.id,
          })
          .$returningId();
        const reference = `EXP-${String(expenseId).padStart(6, "0")}`;
        await tx.update(expenses).set({ reference }).where(eq(expenses.id, expenseId));

        const summary = `Expense ${reference} — ₦${input.amount.toLocaleString()} · ${category.name}${input.vendor ? ` · ${input.vendor}` : ""}`;
        const steps = await getFlowSteps(tx, "EXPENSE");
        if (steps.length === 0) {
          await tx
            .update(expenses)
            .set({ status: "APPROVED", approvedBy: ctx.user.id, approvedAt: new Date() })
            .where(eq(expenses.id, expenseId));
          return { expenseId, reference, outcome: "APPROVED" as const, summary };
        }
        const requestId = await submitApproval(tx, {
          requestType: "EXPENSE_CREATE",
          entityType: "EXPENSE",
          entityId: expenseId,
          payload: {
            reference,
            category: category.name,
            amount: input.amount,
            vendor: input.vendor ?? null,
            expenseDate: input.expenseDate,
            description: input.description,
            receiptUrl: input.receiptUrl ?? null,
          },
          summary,
          requesterId: ctx.user.id,
          steps,
        });
        return { expenseId, reference, outcome: "PENDING" as const, summary, requestId };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: result.outcome === "APPROVED" ? "expense.approved" : "expense.recorded",
        entityType: "EXPENSE",
        entityId: result.expenseId,
        description: result.outcome === "APPROVED" ? `Approved (no approval chain): ${result.summary}` : `Recorded for approval: ${result.summary}`,
        afterData: { reference: result.reference, amount: input.amount, category: category.name },
        ...requestMeta(ctx.req),
      });
      return result;
    }),

  /** Creator withdraws their own still-pending expense. */
  withdraw: permissionProcedure("expenses.create")
    .input(z.object({ expenseId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [expense] = await db.select().from(expenses).where(eq(expenses.id, input.expenseId)).limit(1);
      if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
      if (expense.createdBy !== ctx.user.id && ctx.user.role !== "SUPER_ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only withdraw your own expenses." });
      }
      if (expense.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending expense can be withdrawn." });
      }
      await db.transaction(async (tx) => {
        await tx.update(expenses).set({ status: "REJECTED", rejectedReason: `Withdrawn: ${input.reason}` }).where(eq(expenses.id, expense.id));
        const [request] = await tx
          .select()
          .from(approvalRequests)
          .where(and(eq(approvalRequests.entityType, "EXPENSE"), eq(approvalRequests.entityId, expense.id), eq(approvalRequests.status, "PENDING")))
          .limit(1);
        if (request) {
          await tx
            .update(approvalRequestSteps)
            .set({ status: "SKIPPED", actedAt: new Date() })
            .where(and(eq(approvalRequestSteps.requestId, request.id), eq(approvalRequestSteps.status, "PENDING")));
          await tx.update(approvalRequests).set({ status: "CANCELLED", resolvedAt: new Date() }).where(eq(approvalRequests.id, request.id));
        }
      });
      await logAudit({
        actorId: ctx.user.id,
        action: "expense.withdrawn",
        entityType: "EXPENSE",
        entityId: expense.id,
        description: `Withdrew expense ${expense.reference} — ${input.reason}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),
});
