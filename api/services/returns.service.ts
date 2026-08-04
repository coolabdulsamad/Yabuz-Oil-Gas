import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  customers,
  saleItems,
  sales,
  salesExchangeItems,
  salesExchanges,
  salesReturnItems,
  salesReturns,
} from "@db/schema";
import type { getDb } from "../queries/connection";
import { applyMovement } from "./inventory.service";
import { applyCustomerTx } from "./customers.service";
import { bumpCustomerStats } from "./approvals.service";

/**
 * YABUZ OIL & GAS — Returns & exchanges service
 * The single write-path for the side effects of a COMPLETED return or
 * exchange. Both ride the SALE_RETURN / SALE_EXCHANGE approval chains;
 * the money and stock effects land here, atomically with final approval
 * (or immediately at submission when no chain is configured).
 *
 * RETURN  → items back into stock (when restock), value into the
 *           customer's deposit wallet (clearing outstanding credit first).
 * EXCHANGE→ returned items back in, new items out; the value difference
 *           is settled per settlementType (top-up by cash/transfer/POS/
 *           cheque/deposit wallet/credit — or credited to the deposit
 *           wallet when the new items are cheaper).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function parsePaymentMode(notes: string | null): "PAY_LATER" | "CREDIT" | "DEPOSIT" {
  const m = notes?.match(/\[mode:([A-Z_]+)\]/);
  return m?.[1] === "CREDIT" || m?.[1] === "DEPOSIT" ? m[1] : "PAY_LATER";
}

/* -------------------------------- RETURNS -------------------------------- */

/** Applies all effects of an approved return and marks it COMPLETED. */
export async function applyReturnEffects(tx: Tx, returnId: number, approverId: number) {
  const [ret] = await tx.select().from(salesReturns).where(eq(salesReturns.id, returnId)).limit(1);
  if (!ret) throw new TRPCError({ code: "NOT_FOUND", message: "Return not found." });
  if (ret.status !== "PENDING_APPROVAL") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This return is already ${ret.status.toLowerCase()}.` });
  }
  const [sale] = await tx.select().from(sales).where(eq(sales.id, ret.saleId)).limit(1);
  const items = await tx.select().from(salesReturnItems).where(eq(salesReturnItems.returnId, returnId));

  // 1. Stock back in (or written off when restock = false).
  for (const item of items) {
    if (ret.restock) {
      await applyMovement(tx, {
        productId: item.productId,
        movementType: "RETURN_IN",
        quantity: item.packsRestored,
        referenceType: "RETURN",
        referenceId: returnId,
        reason: `Return ${ret.reference} from sale ${sale?.orderNo ?? ret.saleId}`,
        performedBy: approverId,
      });
    } else {
      // Items are NOT put back (damaged) — no stock movement; the goods were
      // already out, so nothing to reverse. Record is kept on the return itself.
    }
  }

  // 2. Money: value goes to the customer — outstanding credit first, rest to deposit wallet.
  if (ret.customerId && ret.totalAmount > 0) {
    const [cust] = await tx.select().from(customers).where(eq(customers.id, ret.customerId)).limit(1);
    if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
    const toCredit = Number(Math.min(ret.totalAmount, cust.creditOutstanding).toFixed(2));
    const toDeposit = Number((ret.totalAmount - toCredit).toFixed(2));

    if (toCredit > 0) {
      await applyCustomerTx(tx, {
        customerId: ret.customerId,
        transactionType: "ADJUSTMENT",
        creditDelta: -toCredit,
        referenceType: "RETURN",
        referenceId: returnId,
        notes: `Return ${ret.reference} — cleared against outstanding balance`,
        performedBy: approverId,
      });
    }
    if (toDeposit > 0) {
      await applyCustomerTx(tx, {
        customerId: ret.customerId,
        transactionType: "DEPOSIT_IN",
        depositDelta: toDeposit,
        referenceType: "RETURN",
        referenceId: returnId,
        notes: `Return ${ret.reference} — value added to advance deposit wallet`,
        performedBy: approverId,
      });
    }
    await bumpCustomerStats(tx, ret.customerId, -ret.totalAmount);
  }

  // 3. Mark completed.
  await tx
    .update(salesReturns)
    .set({ status: "COMPLETED", approvedBy: approverId, approvedAt: new Date() })
    .where(eq(salesReturns.id, returnId));
}

/* ------------------------------- EXCHANGES ------------------------------- */

/** Applies all effects of an approved exchange and marks it COMPLETED. */
export async function applyExchangeEffects(tx: Tx, exchangeId: number, approverId: number) {
  const [ex] = await tx.select().from(salesExchanges).where(eq(salesExchanges.id, exchangeId)).limit(1);
  if (!ex) throw new TRPCError({ code: "NOT_FOUND", message: "Exchange not found." });
  if (ex.status !== "PENDING_APPROVAL") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This exchange is already ${ex.status.toLowerCase()}.` });
  }
  const [sale] = await tx.select().from(sales).where(eq(sales.id, ex.saleId)).limit(1);
  const items = await tx.select().from(salesExchangeItems).where(eq(salesExchangeItems.exchangeId, exchangeId));
  const returned = items.filter((i) => i.direction === "RETURNED");
  const fresh = items.filter((i) => i.direction === "NEW");

  // 1. Returned items back into stock.
  for (const item of returned) {
    await applyMovement(tx, {
      productId: item.productId,
      movementType: "RETURN_IN",
      quantity: item.packsQty,
      referenceType: "EXCHANGE",
      referenceId: exchangeId,
      reason: `Exchange ${ex.reference} — returned from sale ${sale?.orderNo ?? ex.saleId}`,
      performedBy: approverId,
    });
  }

  // 2. New items out of stock (hard stock guard runs here).
  for (const item of fresh) {
    await applyMovement(tx, {
      productId: item.productId,
      movementType: "EXCHANGE_OUT",
      quantity: -item.packsQty,
      referenceType: "EXCHANGE",
      referenceId: exchangeId,
      reason: `Exchange ${ex.reference} — new items out`,
      performedBy: approverId,
    });
  }

  // 3. Settle the difference.
  const diff = Number((ex.newTotal - ex.returnedTotal).toFixed(2));
  if (ex.customerId && diff !== 0) {
    if (diff > 0) {
      // Customer tops up the extra value.
      if (ex.settlementType === "TOPUP_DEPOSIT") {
        await applyCustomerTx(tx, {
          customerId: ex.customerId,
          transactionType: "DEPOSIT_USED",
          depositDelta: -diff,
          referenceType: "EXCHANGE",
          referenceId: exchangeId,
          notes: `Exchange ${ex.reference} — top-up drawn from deposit wallet`,
          performedBy: approverId,
        });
      } else if (ex.settlementType === "TOPUP_CREDIT") {
        // Re-check the credit headroom at completion time.
        const [cust] = await tx.select().from(customers).where(eq(customers.id, ex.customerId)).limit(1);
        if (cust && cust.creditLimit > 0) {
          const headroom = Number((cust.creditLimit - cust.creditOutstanding).toFixed(2));
          if (diff > headroom) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Credit limit no longer covers this exchange top-up: ${cust.fullName} has ₦${headroom.toLocaleString()} headroom, needs ₦${diff.toLocaleString()}.`,
            });
          }
        }
        await applyCustomerTx(tx, {
          customerId: ex.customerId,
          transactionType: "SALE_DEBIT",
          creditDelta: diff,
          referenceType: "EXCHANGE",
          referenceId: exchangeId,
          notes: `Exchange ${ex.reference} — top-up added to outstanding credit`,
          performedBy: approverId,
        });
      }
      // TOPUP_CASH / TOPUP_TRANSFER / TOPUP_POS / TOPUP_CHEQUE — money received
      // physically; nothing to post to the wallet (proof stored on the exchange).
    } else {
      // New items are cheaper — credit the difference to the deposit wallet.
      const credit = Number((-diff).toFixed(2));
      await applyCustomerTx(tx, {
        customerId: ex.customerId,
        transactionType: "DEPOSIT_IN",
        depositDelta: credit,
        referenceType: "EXCHANGE",
        referenceId: exchangeId,
        notes: `Exchange ${ex.reference} — difference credited to advance deposit wallet`,
        performedBy: approverId,
      });
    }
    await bumpCustomerStats(tx, ex.customerId, diff);
  }

  await tx
    .update(salesExchanges)
    .set({
      status: "COMPLETED",
      settledAmount: Math.abs(diff),
      approvedBy: approverId,
      approvedAt: new Date(),
    })
    .where(eq(salesExchanges.id, exchangeId));
}

/* ------------------------- Remaining-quantity helpers ------------------------- */

/**
 * How much of each sale line is still returnable:
 * sold quantity − already returned/exchanged (completed or pending).
 */
export async function getReturnableQuantities(db: Db | Tx, saleId: number) {
  const sold = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  const pendingOrDone = [ "PENDING_APPROVAL", "COMPLETED" ] as const;
  const used = new Map<number, number>(); // saleItemId → qty already claimed

  const returnRows = await db
    .select({ item: salesReturnItems, status: salesReturns.status })
    .from(salesReturnItems)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
    .where(eq(salesReturns.saleId, saleId));
  for (const r of returnRows) {
    if ((pendingOrDone as readonly string[]).includes(r.status)) {
      used.set(r.item.saleItemId, (used.get(r.item.saleItemId) ?? 0) + r.item.quantity);
    }
  }

  const exchangeRows = await db
    .select({ item: salesExchangeItems, status: salesExchanges.status })
    .from(salesExchangeItems)
    .innerJoin(salesExchanges, eq(salesExchanges.id, salesExchangeItems.exchangeId))
    .where(eq(salesExchanges.saleId, saleId));
  for (const r of exchangeRows) {
    if (r.item.direction === "RETURNED" && r.item.saleItemId && (pendingOrDone as readonly string[]).includes(r.status)) {
      used.set(r.item.saleItemId, (used.get(r.item.saleItemId) ?? 0) + r.item.quantity);
    }
  }

  return sold.map((line) => ({
    ...line,
    alreadyReturned: Number((used.get(line.id) ?? 0).toFixed(3)),
    returnableQty: Number((line.quantity - (used.get(line.id) ?? 0)).toFixed(3)),
  }));
}
