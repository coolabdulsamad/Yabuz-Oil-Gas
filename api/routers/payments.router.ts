import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, gt, inArray, like, lte, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { approvalRequests, approvalRequestSteps, customers, payments, sales, users } from "@db/schema";
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { parsePaymentMode } from "../services/payments.service";
import { recordPaymentWithApproval } from "../services/payment-recording.service";

/**
 * YABUZ OIL & GAS — payments router
 * Every payment carries a proof (except cash) and flows through the
 * configurable PAYMENT/DEPOSIT approval chains. Effects (sale settlement,
 * credit reduction, deposit wallets) land ONLY at confirmation.
 * The recording logic itself lives in payment-recording.service so that
 * customer-side deposit/refund actions share the exact same path.
 */

const createInput = z.object({
  paymentType: z.enum(PAYMENT_TYPES),
  customerId: z.number().int().positive().optional(),
  saleId: z.number().int().positive().optional(),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive("Amount must be greater than zero"),
  proofUrl: z.string().url().max(500).optional(),
  proofPublicId: z.string().max(255).optional(),
  externalReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const paymentsRouter = createRouter({
  /** Completed sales still carrying a balance — feeds the payment form's sale picker. */
  unpaidSales: permissionProcedure("payments.record")
    .input(z.object({ customerId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(sales.status, "COMPLETED" as const), gt(sales.balanceDue, 0)];
      if (input?.customerId) conds.push(eq(sales.customerId, input.customerId));
      const rows = await db
        .select({ sale: sales, customerName: customers.fullName })
        .from(sales)
        .leftJoin(customers, eq(customers.id, sales.customerId))
        .where(and(...conds))
        .orderBy(desc(sales.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.sale.id,
        orderNo: r.sale.orderNo,
        customerId: r.sale.customerId,
        customerName: r.customerName,
        grandTotal: r.sale.grandTotal,
        balanceDue: r.sale.balanceDue,
        paymentMode: parsePaymentMode(r.sale.notes),
      }));
    }),

  list: permissionProcedure("payments.view")
    .input(
      z
        .object({
          status: z.enum(PAYMENT_STATUSES).optional(),
          paymentType: z.enum(PAYMENT_TYPES).optional(),
          customerId: z.number().int().positive().optional(),
          search: z.string().trim().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conds = [];
      if (!ctx.permissions.has("payments.view_all")) conds.push(eq(payments.recordedBy, ctx.user.id));
      if (input?.status) conds.push(eq(payments.status, input.status));
      if (input?.paymentType) conds.push(eq(payments.paymentType, input.paymentType));
      if (input?.customerId) conds.push(eq(payments.customerId, input.customerId));
      if (input?.search) {
        conds.push(or(like(payments.reference, `%${input.search}%`), like(payments.externalReference, `%${input.search}%`))!);
      }
      if (input?.dateFrom) conds.push(gte(payments.createdAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input?.dateTo) conds.push(lte(payments.createdAt, new Date(`${input.dateTo}T23:59:59`)));

      const rows = await db
        .select({ payment: payments, customerName: customers.fullName, orderNo: sales.orderNo, recorderName: users.fullName })
        .from(payments)
        .leftJoin(customers, eq(customers.id, payments.customerId))
        .leftJoin(sales, eq(sales.id, payments.saleId))
        .innerJoin(users, eq(users.id, payments.recordedBy))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(payments.createdAt))
        .limit(300);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [totals] = await db
        .select({
          confirmedToday: sql<string>`COALESCE(SUM(CASE WHEN ${payments.status} = 'CONFIRMED' AND ${payments.confirmedAt} >= ${todayStart} AND ${payments.paymentType} != 'DEPOSIT_REFUND' THEN ${payments.amount} ELSE 0 END), 0)`,
          pendingCount: sql<number>`SUM(CASE WHEN ${payments.status} = 'PENDING_APPROVAL' THEN 1 ELSE 0 END)`,
        })
        .from(payments);

      return {
        items: rows.map((r) => ({ ...r.payment, customerName: r.customerName, orderNo: r.orderNo, recorderName: r.recorderName })),
        stats: { confirmedToday: Number(totals?.confirmedToday ?? 0), pendingCount: Number(totals?.pendingCount ?? 0) },
      };
    }),

  getById: permissionProcedure("payments.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [payment] = await db.select().from(payments).where(eq(payments.id, input.id)).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
      if (payment.recordedBy !== ctx.user.id && !ctx.permissions.has("payments.view_all")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only view your own payments." });
      }
      const customer = payment.customerId
        ? (await db.select().from(customers).where(eq(customers.id, payment.customerId)).limit(1))[0]
        : null;
      const sale = payment.saleId
        ? (await db.select().from(sales).where(eq(sales.id, payment.saleId)).limit(1))[0]
        : null;
      const names = await db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, [payment.recordedBy, payment.confirmedBy].filter((v): v is number => v !== null)));
      const nameById = new Map(names.map((u) => [u.id, u.fullName]));
      return {
        payment,
        customer,
        sale: sale ? { id: sale.id, orderNo: sale.orderNo, grandTotal: sale.grandTotal, balanceDue: sale.balanceDue, paymentStatus: sale.paymentStatus } : null,
        recorderName: nameById.get(payment.recordedBy) ?? null,
        confirmerName: payment.confirmedBy ? (nameById.get(payment.confirmedBy) ?? null) : null,
        canWithdraw: payment.status === "PENDING_APPROVAL" && payment.recordedBy === ctx.user.id,
      };
    }),

  create: permissionProcedure("payments.record")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) =>
        recordPaymentWithApproval(tx, input, ctx.user.id),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: result.outcome === "CONFIRMED" ? "payment.confirmed" : "payment.recorded",
        entityType: "PAYMENT",
        entityId: result.paymentId,
        description: result.outcome === "CONFIRMED" ? `Confirmed (no approval chain): ${result.summary}` : `Recorded for approval: ${result.summary}`,
        afterData: { reference: result.reference, paymentType: input.paymentType, method: input.method, amount: input.amount },
        ...requestMeta(ctx.req),
      });
      return result;
    }),

  /** Recorder withdraws their own still-pending payment. */
  withdraw: permissionProcedure("payments.record")
    .input(z.object({ paymentId: z.number().int().positive(), reason: z.string().trim().min(3).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [payment] = await db.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
      if (payment.recordedBy !== ctx.user.id && !ctx.permissions.has("payments.confirm")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only withdraw your own payments." });
      }
      if (payment.status !== "PENDING_APPROVAL") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending payment can be withdrawn." });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: "REJECTED", rejectedReason: `Withdrawn: ${input.reason}` })
          .where(eq(payments.id, payment.id));
        const [request] = await tx
          .select()
          .from(approvalRequests)
          .where(
            and(
              inArray(approvalRequests.entityType, ["PAYMENT", "DEPOSIT"]),
              eq(approvalRequests.entityId, payment.id),
              eq(approvalRequests.status, "PENDING"),
            ),
          )
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
        action: "payment.withdrawn",
        entityType: "PAYMENT",
        entityId: payment.id,
        description: `Withdrew payment ${payment.reference} — ${input.reason}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),
});
