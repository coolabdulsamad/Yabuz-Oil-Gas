import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { customers, payments, sales } from "@db/schema";
import type { ApprovalFlowEntity, ApprovalType, PaymentMethod, PaymentType } from "@contracts/constants";
import type { getDb } from "../queries/connection";
import { getFlowSteps, submitApproval } from "./approvals.service";
import { confirmPaymentEffects } from "./payments.service";

/**
 * YABUZ OIL & GAS — payment recording orchestrator
 * THE single write-path for recording money movement of any type:
 * sale payments, credit repayments, advance deposits and deposit refunds.
 * Every record carries full payment details (method, external reference,
 * proof) and rides the configurable PAYMENT/DEPOSIT approval chains —
 * effects land ONLY at confirmation. Used by both the payments router
 * and the customer account actions (deposit wallet / refunds), so no
 * feature can bypass details, proof or approval ever again.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Which approval flow + request type each payment type rides on. */
const FLOW_FOR: Record<PaymentType, { entity: ApprovalFlowEntity; requestType: ApprovalType }> = {
  SALE_PAYMENT: { entity: "PAYMENT", requestType: "PAYMENT_RECORD" },
  CREDIT_PAYMENT: { entity: "PAYMENT", requestType: "PAYMENT_RECORD" },
  ADVANCE_DEPOSIT: { entity: "DEPOSIT", requestType: "DEPOSIT_RECORD" },
  DEPOSIT_REFUND: { entity: "DEPOSIT", requestType: "DEPOSIT_REFUND" },
};

const TYPE_LABELS: Record<PaymentType, string> = {
  SALE_PAYMENT: "sale payment",
  CREDIT_PAYMENT: "credit repayment",
  ADVANCE_DEPOSIT: "advance deposit",
  DEPOSIT_REFUND: "deposit refund",
};

export interface RecordPaymentInput {
  paymentType: PaymentType;
  customerId?: number | null;
  saleId?: number | null;
  method: PaymentMethod;
  amount: number;
  proofUrl?: string | null;
  proofPublicId?: string | null;
  externalReference?: string | null;
  notes?: string | null;
}

export interface RecordPaymentResult {
  paymentId: number;
  reference: string;
  outcome: "CONFIRMED" | "PENDING";
  summary: string;
  requestId?: number;
}

async function loadCustomerName(tx: Tx, customerId: number | null | undefined) {
  if (!customerId) return null;
  const [c] = await tx.select({ fullName: customers.fullName }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return c?.fullName ?? null;
}

/**
 * Validates, inserts and routes a payment through its approval chain.
 * MUST be called inside a transaction — when no chain is configured the
 * payment confirms immediately (atomically with the insert).
 */
export async function recordPaymentWithApproval(
  tx: Tx,
  rawInput: RecordPaymentInput,
  userId: number,
): Promise<RecordPaymentResult> {
  let input = rawInput;

  if (input.method === "DEPOSIT_BALANCE") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "To pay from a deposit wallet, create the sale with the deposit settlement mode instead." });
  }
  // Proof is optional for every method — attach it when you have it.

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
      recordedBy: userId,
    })
    .$returningId();
  const reference = `PAY-${String(paymentId).padStart(6, "0")}`;
  await tx.update(payments).set({ reference }).where(eq(payments.id, paymentId));

  const label = TYPE_LABELS[input.paymentType];
  const summary = `${label[0].toUpperCase()}${label.slice(1)} ${reference} — ₦${input.amount.toLocaleString()}${customerName ? ` ${input.paymentType === "DEPOSIT_REFUND" ? "to" : "from"} ${customerName}` : ""}${orderNo ? ` for ${orderNo}` : ""} (${input.method})`;
  const flow = FLOW_FOR[input.paymentType];
  const steps = await getFlowSteps(tx, flow.entity);

  if (steps.length === 0) {
    await confirmPaymentEffects(tx, paymentId, userId);
    return { paymentId, reference, outcome: "CONFIRMED", summary };
  }

  const requestId = await submitApproval(tx, {
    requestType: flow.requestType,
    entityType: flow.entity,
    entityId: paymentId,
    payload: {
      reference,
      paymentType: label,
      method: input.method,
      amount: input.amount,
      customer: customerName,
      sale: orderNo,
      proofUrl: input.proofUrl ?? null,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
    },
    summary,
    requesterId: userId,
    steps,
  });
  return { paymentId, reference, outcome: "PENDING", summary, requestId };
}
