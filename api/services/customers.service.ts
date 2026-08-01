import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { customers, customerTransactions } from "@db/schema";
import type { CustomerTransactionType } from "@contracts/constants";
import type { getDb } from "../queries/connection";

/**
 * YABUZ OIL & GAS — Customer ledger service
 * The single write-path for customer balances. Every change to
 * credit_outstanding (what they owe us) and deposit_balance (money
 * they hold with us) goes through applyCustomerTx(): it writes an
 * immutable customer_transactions row with the resulting balances
 * and updates the cached columns — always inside a transaction.
 *
 * Reused by: deposits & refunds (Step 7), sales incl. overpayment
 * → deposit (Step 8), payments (Step 9).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CustomerTxInput {
  customerId: number;
  transactionType: CustomerTransactionType;
  /** Change to creditOutstanding (+ they owe more, − they paid). */
  creditDelta?: number;
  /** Change to depositBalance (+ money in, − used/refunded). */
  depositDelta?: number;
  referenceType?: string | null; // SALE | PAYMENT | DEPOSIT | MANUAL
  referenceId?: number | null;
  notes?: string | null;
  performedBy?: number | null;
}

export async function applyCustomerTx(tx: Tx, input: CustomerTxInput) {
  const rows = await tx.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
  const customer = rows[0];
  if (!customer) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Customer #${input.customerId} not found.` });
  }

  const creditDelta = Number((input.creditDelta ?? 0).toFixed(2));
  const depositDelta = Number((input.depositDelta ?? 0).toFixed(2));
  const creditBalanceAfter = Number((customer.creditOutstanding + creditDelta).toFixed(2));
  const depositBalanceAfter = Number((customer.depositBalance + depositDelta).toFixed(2));

  if (creditBalanceAfter < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This would take "${customer.fullName}"'s outstanding balance below zero.`,
    });
  }
  if (depositBalanceAfter < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${customer.fullName}" only has ₦${customer.depositBalance.toLocaleString()} in their deposit wallet.`,
    });
  }

  const [{ id: transactionId }] = await tx
    .insert(customerTransactions)
    .values({
      customerId: customer.id,
      transactionType: input.transactionType,
      creditDelta,
      depositDelta,
      creditBalanceAfter,
      depositBalanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      performedBy: input.performedBy ?? null,
    })
    .$returningId();

  await tx
    .update(customers)
    .set({ creditOutstanding: creditBalanceAfter, depositBalance: depositBalanceAfter })
    .where(eq(customers.id, customer.id));

  return { transactionId, customer, creditBalanceAfter, depositBalanceAfter };
}
