import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, like } from "drizzle-orm";
import { customers, payments, sales } from "@db/schema";
import type { getDb } from "../queries/connection";
import { applyCustomerTx } from "./customers.service";

/**
 * YABUZ OIL & GAS — Payments service
 * The single write-path for CONFIRMING money movement. Recording a payment
 * only creates a PENDING_APPROVAL row; the wallet/sale effects land here,
 * atomically with the final approval (or immediately when no chain exists).
 *
 * Split rules at confirmation:
 *   SALE_PAYMENT   → appliedToSale covers the sale's balance; any excess
 *                    (overpayment) flows into the customer's deposit wallet.
 *                    Credit-mode sales also reduce the customer's outstanding.
 *   CREDIT_PAYMENT → reduces outstanding (settling the customer's credit
 *                    sales oldest-first); excess flows into the deposit wallet.
 *   ADVANCE_DEPOSIT→ whole amount into the deposit wallet.
 *   DEPOSIT_REFUND → paid back out of the deposit wallet (balance-guarded).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function parsePaymentMode(notes: string | null): "PAY_LATER" | "CREDIT" | "DEPOSIT" {
  const m = notes?.match(/\[mode:([A-Z_]+)\]/);
  return m?.[1] === "CREDIT" || m?.[1] === "DEPOSIT" ? m[1] : "PAY_LATER";
}

/** Applies all business effects of a payment and marks it CONFIRMED. */
export async function confirmPaymentEffects(tx: Tx, paymentId: number, confirmerId: number) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
  if (payment.status !== "PENDING_APPROVAL") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This payment is already ${payment.status.toLowerCase()}.` });
  }

  let appliedToSale = 0;
  let addedToDeposit = 0;

  if (payment.paymentType === "SALE_PAYMENT") {
    if (!payment.saleId) throw new TRPCError({ code: "BAD_REQUEST", message: "This payment isn't linked to a sale." });
    const [sale] = await tx.select().from(sales).where(eq(sales.id, payment.saleId)).limit(1);
    if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Linked sale not found." });
    if (sale.status !== "COMPLETED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is ${sale.status.toLowerCase()} — payments can only be confirmed against completed sales.` });
    }
    if (sale.balanceDue <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is already fully paid.` });
    }

    appliedToSale = Number(Math.min(payment.amount, sale.balanceDue).toFixed(2));
    const excess = Number((payment.amount - appliedToSale).toFixed(2));

    // Sale settlement.
    const amountPaid = Number((sale.amountPaid + appliedToSale).toFixed(2));
    const balanceDue = Number((sale.grandTotal - amountPaid).toFixed(2));
    await tx
      .update(sales)
      .set({
        amountPaid,
        balanceDue,
        paymentStatus: balanceDue <= 0 ? "PAID" : "PARTIAL",
      })
      .where(eq(sales.id, sale.id));

    // Customer wallet effects.
    if (payment.customerId) {
      const mode = parsePaymentMode(sale.notes);
      let toDeposit = excess;
      if (mode === "CREDIT" && appliedToSale > 0) {
        // Paying off a credit sale also clears the customer's debt.
        const [cust] = await tx.select().from(customers).where(eq(customers.id, payment.customerId)).limit(1);
        const creditReduction = Number(Math.min(appliedToSale, cust?.creditOutstanding ?? 0).toFixed(2));
        if (creditReduction > 0) {
          await applyCustomerTx(tx, {
            customerId: payment.customerId,
            transactionType: "PAYMENT_CREDIT",
            creditDelta: -creditReduction,
            referenceType: "PAYMENT",
            referenceId: paymentId,
            notes: `Payment ${payment.reference} against credit sale ${sale.orderNo}`,
            performedBy: confirmerId,
          });
        }
        // If the debt was already settled another way, the unused part joins the deposit.
        toDeposit = Number((toDeposit + (appliedToSale - creditReduction)).toFixed(2));
      }
      if (toDeposit > 0) {
        addedToDeposit = toDeposit;
        await applyCustomerTx(tx, {
          customerId: payment.customerId,
          transactionType: "DEPOSIT_IN",
          depositDelta: toDeposit,
          referenceType: "PAYMENT",
          referenceId: paymentId,
          notes: `Overpayment on ${sale.orderNo} moved into deposit wallet (${payment.reference})`,
          performedBy: confirmerId,
        });
      }
    }
  } else if (payment.paymentType === "CREDIT_PAYMENT") {
    if (!payment.customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Credit payments need a customer." });
    const [cust] = await tx.select().from(customers).where(eq(customers.id, payment.customerId)).limit(1);
    if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
    const reduction = Number(Math.min(payment.amount, cust.creditOutstanding).toFixed(2));
    if (reduction <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${cust.fullName} has no outstanding balance — record an advance deposit instead.` });
    }
    await applyCustomerTx(tx, {
      customerId: payment.customerId,
      transactionType: "PAYMENT_CREDIT",
      creditDelta: -reduction,
      referenceType: "PAYMENT",
      referenceId: paymentId,
      notes: `Credit repayment ${payment.reference}`,
      performedBy: confirmerId,
    });
    // Settle the customer's credit sales oldest-first so sale-level balances
    // stay in lockstep with the outstanding ledger.
    let remaining = reduction;
    if (remaining > 0) {
      const openCreditSales = await tx
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.customerId, payment.customerId),
            eq(sales.status, "COMPLETED"),
            gt(sales.balanceDue, 0),
            like(sales.notes, "[mode:CREDIT]%"),
          ),
        )
        .orderBy(asc(sales.createdAt), asc(sales.id));
      for (const s of openCreditSales) {
        if (remaining <= 0) break;
        const applied = Number(Math.min(remaining, s.balanceDue).toFixed(2));
        const amountPaid = Number((s.amountPaid + applied).toFixed(2));
        const balanceDue = Number((s.grandTotal - amountPaid).toFixed(2));
        await tx
          .update(sales)
          .set({ amountPaid, balanceDue, paymentStatus: balanceDue <= 0 ? "PAID" : "PARTIAL" })
          .where(eq(sales.id, s.id));
        remaining = Number((remaining - applied).toFixed(2));
      }
    }
    const excess = Number((payment.amount - reduction).toFixed(2));
    if (excess > 0) {
      addedToDeposit = excess;
      await applyCustomerTx(tx, {
        customerId: payment.customerId,
        transactionType: "DEPOSIT_IN",
        depositDelta: excess,
        referenceType: "PAYMENT",
        referenceId: paymentId,
        notes: `Excess on credit repayment ${payment.reference} moved into deposit wallet`,
        performedBy: confirmerId,
      });
    }
  } else if (payment.paymentType === "ADVANCE_DEPOSIT") {
    if (!payment.customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Deposits need a customer." });
    addedToDeposit = payment.amount;
    await applyCustomerTx(tx, {
      customerId: payment.customerId,
      transactionType: "DEPOSIT_IN",
      depositDelta: payment.amount,
      referenceType: "PAYMENT",
      referenceId: paymentId,
      notes: `Advance deposit ${payment.reference}`,
      performedBy: confirmerId,
    });
  } else {
    // DEPOSIT_REFUND — money back out to the customer (balance-guarded).
    if (!payment.customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Refunds need a customer." });
    await applyCustomerTx(tx, {
      customerId: payment.customerId,
      transactionType: "DEPOSIT_REFUND",
      depositDelta: -payment.amount,
      referenceType: "PAYMENT",
      referenceId: paymentId,
      notes: `Deposit refund ${payment.reference}`,
      performedBy: confirmerId,
    });
  }

  await tx
    .update(payments)
    .set({
      status: "CONFIRMED",
      appliedToSale,
      addedToDeposit,
      confirmedBy: confirmerId,
      confirmedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));

  return { appliedToSale, addedToDeposit };
}
