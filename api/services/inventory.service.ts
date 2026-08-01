import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { products, stockMovements } from "@db/schema";
import type { StockMovementType } from "@contracts/constants";
import type { getDb } from "../queries/connection";

/**
 * YABUZ OIL & GAS — Inventory service
 * The single write-path for stock balances. Every change to
 * products.current_stock goes through applyMovement(): it reads the
 * live balance, writes an immutable stock_movements ledger row
 * (with the resulting balance) and updates the cached balance —
 * always inside the caller's transaction.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface MovementInput {
  productId: number;
  movementType: StockMovementType;
  /** Signed quantity in PACKS: + in, − out. */
  quantity: number;
  referenceType?: string | null;
  referenceId?: number | null;
  reason?: string | null;
  notes?: string | null;
  performedBy?: number | null;
  approvedBy?: number | null;
  /** Allow the balance to go below zero (default false). */
  allowNegative?: boolean;
}

export async function applyMovement(tx: Tx, input: MovementInput) {
  const rows = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
  const product = rows[0];
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Product #${input.productId} not found.` });
  }

  const balanceAfter = Number((product.currentStock + input.quantity).toFixed(3));
  if (balanceAfter < 0 && !input.allowNegative) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not enough stock for "${product.name}" — only ${product.currentStock} pack(s) on hand.`,
    });
  }

  const [{ id: movementId }] = await tx
    .insert(stockMovements)
    .values({
      productId: product.id,
      movementType: input.movementType,
      quantity: input.quantity,
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      performedBy: input.performedBy ?? null,
      approvedBy: input.approvedBy ?? null,
    })
    .$returningId();

  await tx.update(products).set({ currentStock: balanceAfter }).where(eq(products.id, product.id));

  return { movementId, balanceAfter, product };
}
