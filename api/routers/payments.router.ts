import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, gt, inArray, like, lte, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { approvalRequests, approvalRequestSteps, customers, payments, sales, users } from "@db/schema";
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } from "@contracts/constants";
import type { ApprovalFlowEntity, ApprovalType } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { getFlowSteps, submitApproval } from "../services/approvals.service";
import { confirmPaymentEffects, parsePaymentMode } from "../services/payments.service";
import type { getDb as getDbType } from "../queries/connection";

/**
 * YABUZ OIL & GAS — payments router
 * Every payment carries a proof (except cash) and flows through the
 * configurable PAYMENT/DEPOSIT approval chains. Effects (sale settlement,
 * credit reduction, deposit wallets) land ONLY at confirmation.
 */

type Db = ReturnType<typeof getDbType>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Which approval flow + request type each payment type rides on. */
const FLOW_FOR: Record<(typeof PAYMENT_TYPES)[number], { entity: ApprovalFlowEntity; requestType: ApprovalType }> = {
  SALE_PAYMENT: { entity: "PAYMENT", requestType: "PAYMENT_RECORD" },
  CREDIT_PAYMENT: { entity: "PAYMENT", requestType: "PAYMENT_RECORD" },
  ADVANCE_DEPOSIT: { entity: "DEPOSIT", requestType: "DEPOSIT_RECORD" },
  DEPOSIT_REFUND: { entity: "DEPOSIT", requestType: "DEPOSIT_REFUND" },
};

const TYPE_LABELS: Record<string, string> = {
  SALE_PAYMENT: "sale payment",
  CREDIT_PAYMENT: "credit repayment",
  ADVANCE_DEPOSIT: "advance deposit",
  DEPOSIT_REFUND: "deposit refund",
};

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

async function loadCustomerName(tx: Tx, customerId: number | null | undefined) {
  if (!customerId) return null;
  const [c] = await tx.select({ fullName: customers.fullName }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return c?.fullName ?? null;
}

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
      if (input.method === "DEPOSIT_BALANCE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "To pay from a deposit wallet, create the sale with the deposit settlement mode instead." });
      }
      if (input.method !== "CASH" && !input.proofUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Attach a payment proof (receipt / transfer screenshot) — required for non-cash payments." });
      }

      const result = await db.transaction(async (tx) => {
        let customerName: string | null = null;
        let orderNo: string | null = null;

        if (input.paymentType === "SALE_PAYMENT") {
          if (!input.saleId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the sale this payment settles." });
          const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).limit(1);
          if (!sale) throw new TRPCError({ code: "BAD_REQUEST", message: "Sale not found." });
          if (sale.status !== "COMPLETED") throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is ${sale.status.toLowerCase()} — only completed sales can receive payments.` });
          if (sale.balanceDue <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is already fully paid.` });
          orderNo = sale.orderNo;
          const customerId = input.customerId ?? sale.customerId ?? null;
          if (input.amount > sale.balanceDue && !customerId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This overpays the sale — overpayments flow into a customer's deposit wallet, so pick a customer account." });
          }
          if (sale.customerId && input.customerId && input.customerId !== sale.customerId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This sale belongs to a different customer." });
          }
          input = { ...input, customerId: customerId ?? undefined };
          customerName = await loadCustomerName(tx, customerId);
        } else {
          if (!input.customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a customer." });
          const [cust] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
          if (!cust) throw new TRPCError({ code: "BAD_REQUEST", message: "Customer not found." });
          if (cust.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Customer "${cust.fullName}" is ${cust.status.toLowerCase()}.` });
          if (input.paymentType === "CREDIT_PAYMENT" && cust.creditOutstanding <= 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${cust.fullName} has no outstanding balance — record an advance deposit instead.` });
          }
          if (input.paymentType === "DEPOSIT_REFUND" && input.amount > cust.depositBalance) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Refund exceeds the deposit balance (₦${cust.depositBalance.toLocaleString()}).` });
          }
          customerName = cust.fullName;
        }

        const [{ id: paymentId }] = await tx
          .insert(payments)
          .values({
            reference: "PENDING",
            customerId: input.customerId ?? null,
            saleId: input.paymentType === "SALE_PAYMENT" ? (input.saleId ?? null) : null,
            paymentType: input.paymentType,
            method: input.method,
            amount: input.amount,
            proofUrl: input.proofUrl ?? null,
            proofPublicId: input.proofPublicId ?? null,
            externalReference: input.externalReference || null,
            notes: input.notes || null,
            status: "PENDING_APPROVAL",
            recordedBy: ctx.user.id,
          })
          .$returningId();
        const reference = `PAY-${String(paymentId).padStart(6, "0")}`;
        await tx.update(payments).set({ reference }).where(eq(payments.id, paymentId));

        const summary = `${TYPE_LABELS[input.paymentType][0].toUpperCase()}${TYPE_LABELS[input.paymentType].slice(1)} ${reference} — ₦${input.amount.toLocaleString()}${customerName ? ` from ${customerName}` : ""}${orderNo ? ` for ${orderNo}` : ""} (${input.method})`;
        const flow = FLOW_FOR[input.paymentType];
        const steps = await getFlowSteps(tx, flow.entity);

        if (steps.length === 0) {
          await confirmPaymentEffects(tx, paymentId, ctx.user.id);
          return { paymentId, reference, outcome: "CONFIRMED" as const, summary };
        }

        const requestId = await submitApproval(tx, {
          requestType: flow.requestType,
          entityType: flow.entity,
          entityId: paymentId,
          payload: {
            reference,
            paymentType: TYPE_LABELS[input.paymentType],
            method: input.method,
            amount: input.amount,
            customer: customerName,
            sale: orderNo,
            proofUrl: input.proofUrl ?? null,
            externalReference: input.externalReference ?? null,
            notes: input.notes ?? null,
          },
          summary,
          requesterId: ctx.user.id,
          steps,
        });
        return { paymentId, reference, outcome: "PENDING" as const, summary, requestId };
      });

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
