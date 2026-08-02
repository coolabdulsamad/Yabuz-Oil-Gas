import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import {
  approvalFlows,
  approvalRequests,
  approvalRequestSteps,
  sales,
  saleItems,
  customers,
  payments,
  expenses,
} from "@db/schema";
import type { ApprovalFlowEntity, ApprovalType } from "@contracts/constants";
import type { getDb } from "../queries/connection";
import { applyMovement } from "./inventory.service";
import { applyCustomerTx } from "./customers.service";
import { confirmPaymentEffects } from "./payments.service";
import { notifyRoles, notifyUsers } from "./notifications.service";

/**
 * YABUZ OIL & GAS — Approval workflow engine
 * Configurable chains per entity type (set by Admin/Super Admin):
 * e.g. SALE → ["MANAGER"] or ["MANAGER","ADMIN"].
 *
 * submitApproval() starts a request; actOnRequest() moves it through
 * the chain; on the final approval the engine applies the business
 * side-effects (stock release, credit/debit ledger) atomically.
 * Every submission, step and resolution drops a notification in the
 * bell of whoever needs to act (or whoever asked).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** "SALE_CREATE" → "Sale create" (for notification titles). */
function humanize(requestType: string) {
  return requestType
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Ordered roles allowed inside a chain (super admin can already do everything). */
export const CHAIN_ROLES = ["MANAGER", "ADMIN"] as const;

/** The active chain for an entity type — [] means "no approval required". */
export async function getFlowSteps(db: Db | Tx, entityType: ApprovalFlowEntity): Promise<string[]> {
  const rows = await db
    .select()
    .from(approvalFlows)
    .where(eq(approvalFlows.entityType, entityType))
    .limit(1);
  const flow = rows[0];
  if (!flow || !flow.isActive) return [];
  return flow.steps;
}

export interface SubmitInput {
  requestType: ApprovalType;
  entityType: string;
  entityId: number;
  payload: Record<string, unknown>;
  summary: string;
  requesterId: number;
  steps: string[];
}

/** Creates the request + one row per chain step (step 1 PENDING, rest WAITING). */
export async function submitApproval(tx: Tx, input: SubmitInput) {
  const [{ id: requestId }] = await tx
    .insert(approvalRequests)
    .values({
      requestType: input.requestType,
      status: "PENDING",
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
      summary: input.summary,
      totalSteps: input.steps.length,
      currentStep: 1,
      requesterId: input.requesterId,
    })
    .$returningId();

  for (let i = 0; i < input.steps.length; i++) {
    await tx.insert(approvalRequestSteps).values({
      requestId,
      stepOrder: i + 1,
      role: input.steps[i] as "MANAGER" | "ADMIN",
      status: i === 0 ? "PENDING" : "WAITING",
    });
  }

  // Bell: everyone who can act on step 1 (plus super admins) hears about it.
  await notifyRoles(
    tx,
    [input.steps[0], "SUPER_ADMIN"],
    {
      type: "APPROVAL_REQUEST",
      title: `Approval needed: ${humanize(input.requestType)}`,
      body: input.summary,
      link: "/approvals",
    },
    [input.requesterId],
  );

  return requestId;
}

/* ------------------------------------------------------------------ */
/*  Side-effects applied when a request clears its final step          */
/* ------------------------------------------------------------------ */

/**
 * SALE finalization → release stock and apply wallet effects.
 * Called on the final approval step, or directly at submission time when
 * the SALE flow has no chain (status DRAFT/ON_HOLD then). Atomic with the caller.
 */
export async function finalizeSale(tx: Tx, saleId: number, approverId: number) {
  const found = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  const sale = found[0];
  if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  if (sale.status !== "PENDING_APPROVAL" && sale.status !== "DRAFT" && sale.status !== "ON_HOLD") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This sale can no longer be completed." });
  }

  const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  // 1. Release stock (fails the whole approval if any line is short).
  for (const item of items) {
    await applyMovement(tx, {
      productId: item.productId,
      movementType: "SALE_OUT",
      quantity: -item.packsDeducted,
      referenceType: "SALE",
      referenceId: saleId,
      reason: `Sale ${sale.orderNo}`,
      performedBy: approverId,
    });
  }

  // 2. Customer wallet effects.
  const paymentMode = (sale.notes?.match(/\[mode:([A-Z_]+)\]/) ?? [])[1] ?? "PAY_LATER";
  if (sale.customerId) {
    if (paymentMode === "CREDIT" && sale.grandTotal > 0) {
      // Re-check the limit at finalization — balances may have moved while
      // the sale sat in the approval queue.
      const [cust] = await tx.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
      if (cust) {
        const headroom = Number((cust.creditLimit - cust.creditOutstanding).toFixed(2));
        if (cust.creditLimit <= 0 || sale.grandTotal > headroom) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Credit limit no longer covers this sale: ${cust.fullName} owes ₦${cust.creditOutstanding.toLocaleString()} of a ₦${cust.creditLimit.toLocaleString()} limit. Raise the limit or reject the sale.`,
          });
        }
      }
      await applyCustomerTx(tx, {
        customerId: sale.customerId,
        transactionType: "SALE_DEBIT",
        creditDelta: sale.grandTotal,
        referenceType: "SALE",
        referenceId: saleId,
        notes: `Credit sale ${sale.orderNo}`,
        performedBy: approverId,
      });
    } else if (paymentMode === "DEPOSIT" && sale.grandTotal > 0) {
      await applyCustomerTx(tx, {
        customerId: sale.customerId,
        transactionType: "DEPOSIT_USED",
        depositDelta: -sale.grandTotal,
        referenceType: "SALE",
        referenceId: saleId,
        notes: `Deposit wallet used for sale ${sale.orderNo}`,
        performedBy: approverId,
      });
    }

    // 3. Lifetime stats (re-reads inside tx and adds the sale amount).
    await bumpCustomerStats(tx, sale.customerId, sale.grandTotal);
  }

  // 4. Complete the sale.
  const paidNow = paymentMode === "DEPOSIT";
  await tx
    .update(sales)
    .set({
      status: "COMPLETED",
      usedDeposit: paymentMode === "DEPOSIT",
      amountPaid: paidNow ? sale.grandTotal : 0,
      balanceDue: paidNow ? 0 : sale.grandTotal,
      paymentStatus: paidNow ? "PAID" : "UNPAID",
      finalApprovedBy: approverId,
      finalApprovedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(sales.id, saleId));
}

/** Add a completed sale to the customer's lifetime totals (re-reads inside tx). */
export async function bumpCustomerStats(tx: Tx, customerId: number, amount: number) {
  const rows = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  const c = rows[0];
  if (!c) return;
  await tx
    .update(customers)
    .set({
      totalSpent: Number((c.totalSpent + amount).toFixed(2)),
      lastSaleAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}

export interface ActInput {
  requestId: number;
  reviewerId: number;
  reviewerRole: string;
  action: "APPROVE" | "REJECT";
  note?: string;
}

/**
 * Moves a request one step. Returns the resulting request status.
 * Side-effects run inside one transaction with the step update.
 */
export async function actOnRequest(db: Db, input: ActInput) {
  return db.transaction(async (tx) => {
    const reqRows = await tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, input.requestId))
      .limit(1);
    const request = reqRows[0];
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found." });
    if (request.status !== "PENDING") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `This request is already ${request.status.toLowerCase()}.` });
    }
    if (request.requesterId === input.reviewerId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can't review your own request." });
    }

    const stepRows = await tx
      .select()
      .from(approvalRequestSteps)
      .where(
        and(
          eq(approvalRequestSteps.requestId, request.id),
          eq(approvalRequestSteps.stepOrder, request.currentStep),
        ),
      )
      .limit(1);
    const step = stepRows[0];
    if (!step) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Approval chain is broken." });
    if (step.status !== "PENDING") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This step has already been actioned." });
    }
    if (step.role !== input.reviewerRole && input.reviewerRole !== "SUPER_ADMIN") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This step is waiting on a ${step.role.toLowerCase()}.`,
      });
    }

    await tx
      .update(approvalRequestSteps)
      .set({
        status: input.action === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewerId: input.reviewerId,
        reviewNote: input.note ?? null,
        actedAt: new Date(),
      })
      .where(eq(approvalRequestSteps.id, step.id));

    if (input.action === "REJECT") {
      await tx
        .update(approvalRequests)
        .set({ status: "REJECTED", resolvedAt: new Date() })
        .where(eq(approvalRequests.id, request.id));

      if (request.entityId) {
        if (request.requestType === "SALE_CREATE") {
          await tx.update(sales).set({ status: "REJECTED" }).where(eq(sales.id, request.entityId));
        } else if (
          request.requestType === "PAYMENT_RECORD" ||
          request.requestType === "DEPOSIT_RECORD" ||
          request.requestType === "DEPOSIT_REFUND"
        ) {
          await tx
            .update(payments)
            .set({ status: "REJECTED", rejectedReason: input.note ?? "Rejected" })
            .where(eq(payments.id, request.entityId));
        } else if (request.requestType === "EXPENSE_CREATE") {
          await tx
            .update(expenses)
            .set({ status: "REJECTED", rejectedReason: input.note ?? "Rejected" })
            .where(eq(expenses.id, request.entityId));
        }
      }

      // Bell: tell the requester their request was rejected.
      await notifyUsers(tx, [request.requesterId], {
        type: "APPROVAL_RESULT",
        title: `Rejected: ${humanize(request.requestType)}`,
        body: `${request.summary}${input.note ? ` — ${input.note}` : ""}`,
        link: "/approvals",
      });

      return { status: "REJECTED" as const, request };
    }

    // Approved this step — is there another?
    if (request.currentStep < request.totalSteps) {
      await tx
        .update(approvalRequestSteps)
        .set({ status: "PENDING" })
        .where(
          and(
            eq(approvalRequestSteps.requestId, request.id),
            eq(approvalRequestSteps.stepOrder, request.currentStep + 1),
          ),
        );
      await tx
        .update(approvalRequests)
        .set({ currentStep: request.currentStep + 1 })
        .where(eq(approvalRequests.id, request.id));

      // Bell: next step's role takes over.
      const nextRole = (await tx
        .select({ role: approvalRequestSteps.role })
        .from(approvalRequestSteps)
        .where(
          and(
            eq(approvalRequestSteps.requestId, request.id),
            eq(approvalRequestSteps.stepOrder, request.currentStep + 1),
          ),
        )
        .limit(1))[0]?.role;
      if (nextRole) {
        await notifyRoles(
          tx,
          [nextRole, "SUPER_ADMIN"],
          {
            type: "APPROVAL_REQUEST",
            title: `Approval needed: ${humanize(request.requestType)}`,
            body: `${request.summary} (step ${request.currentStep + 1} of ${request.totalSteps})`,
            link: "/approvals",
          },
          [request.requesterId],
        );
      }

      return { status: "PENDING" as const, request };
    }

    // Final approval — apply business effects.
    if (request.entityId) {
      if (request.requestType === "SALE_CREATE") {
        await finalizeSale(tx, request.entityId, input.reviewerId);
      } else if (
        request.requestType === "PAYMENT_RECORD" ||
        request.requestType === "DEPOSIT_RECORD" ||
        request.requestType === "DEPOSIT_REFUND"
      ) {
        await confirmPaymentEffects(tx, request.entityId, input.reviewerId);
      } else if (request.requestType === "EXPENSE_CREATE") {
        await tx
          .update(expenses)
          .set({ status: "APPROVED", approvedBy: input.reviewerId, approvedAt: new Date() })
          .where(eq(expenses.id, request.entityId));
      } else if (request.requestType === "CUSTOMER_CREDIT_LIMIT") {
        const payload = request.payload as { customerId?: number; creditLimit?: number } | null;
        if (payload?.customerId && typeof payload.creditLimit === "number") {
          await tx
            .update(customers)
            .set({ creditLimit: payload.creditLimit })
            .where(eq(customers.id, payload.customerId));
        }
      }
    }

    await tx
      .update(approvalRequests)
      .set({ status: "APPROVED", resolvedAt: new Date() })
      .where(eq(approvalRequests.id, request.id));

    // Bell: tell the requester their request cleared the whole chain.
    await notifyUsers(tx, [request.requesterId], {
      type: "APPROVAL_RESULT",
      title: `Approved: ${humanize(request.requestType)}`,
      body: request.summary,
      link: "/approvals",
    });

    return { status: "APPROVED" as const, request };
  });
}

/** List a request with its steps, for display. */
export async function getRequestWithSteps(db: Db, requestId: number) {
  const reqRows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  const request = reqRows[0];
  if (!request) return null;
  const steps = await db
    .select()
    .from(approvalRequestSteps)
    .where(eq(approvalRequestSteps.requestId, requestId))
    .orderBy(asc(approvalRequestSteps.stepOrder));
  return { ...request, steps };
}
