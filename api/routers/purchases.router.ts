import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { products, purchaseItems, purchases, suppliers, users } from "@db/schema";
import { PURCHASE_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { applyMovement } from "../services/inventory.service";

/**
 * YABUZ OIL & GAS — purchase orders router
 * Orders placed to Polar Petrochemicals (or other suppliers):
 *   PENDING → APPROVED → (PARTIALLY_RECEIVED) → RECEIVED, or CANCELLED.
 * Receiving stock writes PURCHASE_IN movements — balances never change
 * outside the ledger.
 */

const purchaseItemInput = z.object({
  productId: z.number(),
  quantity: z.number().positive("Quantity must be greater than zero"),
  unitCost: z.number().min(0),
});

export const purchasesRouter = createRouter({
  list: permissionProcedure("inventory.manage_purchases")
    .input(
      z.object({
        status: z.enum(PURCHASE_STATUSES).optional(),
        supplierId: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.status) conds.push(eq(purchases.status, input.status));
      if (input.supplierId) conds.push(eq(purchases.supplierId, input.supplierId));

      const rows = await db
        .select({
          id: purchases.id,
          reference: purchases.reference,
          status: purchases.status,
          subtotal: purchases.subtotal,
          totalCost: purchases.totalCost,
          notes: purchases.notes,
          expectedAt: purchases.expectedAt,
          receivedAt: purchases.receivedAt,
          createdAt: purchases.createdAt,
          supplierName: suppliers.name,
          createdByName: users.fullName,
        })
        .from(purchases)
        .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
        .leftJoin(users, eq(purchases.createdBy, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(purchases.createdAt));

      const itemStats = await db
        .select({
          purchaseId: purchaseItems.purchaseId,
          lines: count(),
          totalQty: sql<number>`COALESCE(SUM(${purchaseItems.quantity}), 0)`.as("total_qty"),
          receivedQty: sql<number>`COALESCE(SUM(${purchaseItems.receivedQty}), 0)`.as("received_qty"),
        })
        .from(purchaseItems)
        .groupBy(purchaseItems.purchaseId);
      const statMap = new Map(itemStats.map((r) => [r.purchaseId, r]));

      return rows.map((r) => ({
        ...r,
        lineCount: statMap.get(r.id)?.lines ?? 0,
        totalQty: Number(statMap.get(r.id)?.totalQty ?? 0),
        receivedQty: Number(statMap.get(r.id)?.receivedQty ?? 0),
      }));
    }),

  getById: permissionProcedure("inventory.manage_purchases")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const found = await db
        .select({
          id: purchases.id,
          reference: purchases.reference,
          status: purchases.status,
          subtotal: purchases.subtotal,
          totalCost: purchases.totalCost,
          notes: purchases.notes,
          expectedAt: purchases.expectedAt,
          receivedAt: purchases.receivedAt,
          createdAt: purchases.createdAt,
          supplierId: purchases.supplierId,
          supplierName: suppliers.name,
          supplierPhone: suppliers.phone,
          createdByName: users.fullName,
        })
        .from(purchases)
        .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
        .leftJoin(users, eq(purchases.createdBy, users.id))
        .where(eq(purchases.id, input.id))
        .limit(1);
      const purchase = found[0];
      if (!purchase) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });

      const items = await db
        .select({
          id: purchaseItems.id,
          productId: purchaseItems.productId,
          quantity: purchaseItems.quantity,
          unitCost: purchaseItems.unitCost,
          lineTotal: purchaseItems.lineTotal,
          receivedQty: purchaseItems.receivedQty,
          productName: products.name,
          sku: products.sku,
          packDescription: products.packDescription,
          currentStock: products.currentStock,
        })
        .from(purchaseItems)
        .innerJoin(products, eq(purchaseItems.productId, products.id))
        .where(eq(purchaseItems.purchaseId, purchase.id))
        .orderBy(asc(products.name));

      return { ...purchase, items };
    }),

  create: permissionProcedure("inventory.manage_purchases")
    .input(
      z.object({
        supplierId: z.number(),
        expectedAt: z.string().optional().or(z.literal("")), // YYYY-MM-DD
        notes: z.string().max(2000).optional().or(z.literal("")),
        items: z.array(purchaseItemInput).min(1, "Add at least one item"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const supplier = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found." });

      // Validate products and compute totals.
      const subtotal = Number(
        input.items.reduce((s, i) => s + i.quantity * i.unitCost, 0).toFixed(2),
      );

      const purchaseId = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(purchases)
          .values({
            reference: "TMP",
            supplierId: input.supplierId,
            status: "PENDING",
            subtotal,
            totalCost: subtotal,
            notes: input.notes || null,
            expectedAt: input.expectedAt ? new Date(`${input.expectedAt}T00:00:00`) : null,
            createdBy: ctx.user.id,
          })
          .$returningId();
        const reference = `PO-${String(id).padStart(6, "0")}`;
        await tx.update(purchases).set({ reference }).where(eq(purchases.id, id));

        for (const item of input.items) {
          const p = await tx.select({ id: products.id }).from(products).where(eq(products.id, item.productId)).limit(1);
          if (!p[0]) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Product #${item.productId} not found.` });
          }
          await tx.insert(purchaseItems).values({
            purchaseId: id,
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            lineTotal: Number((item.quantity * item.unitCost).toFixed(2)),
          });
        }
        return id;
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "purchase.create",
        entityType: "PURCHASE",
        entityId: purchaseId,
        description: `Created purchase order PO-${String(purchaseId).padStart(6, "0")} for ${supplier[0].name} — ${input.items.length} line(s), ₦${subtotal.toLocaleString()}.`,
        afterData: { supplierId: input.supplierId, items: input.items.length, subtotal },
        ...requestMeta(ctx.req),
      });
      return { ok: true, id: purchaseId };
    }),

  /** PENDING → APPROVED (cleared to order/receive). */
  approve: permissionProcedure("inventory.manage_purchases")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(purchases).where(eq(purchases.id, input.id)).limit(1);
      const po = found[0];
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
      if (po.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending order can be approved." });
      }
      await db
        .update(purchases)
        .set({ status: "APPROVED", approvedBy: ctx.user.id })
        .where(eq(purchases.id, po.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "purchase.approve",
        entityType: "PURCHASE",
        entityId: po.id,
        description: `Approved purchase order ${po.reference}.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /**
   * Receive stock against an approved/partially-received order.
   * Pass the quantities arriving NOW per line (0 = nothing this delivery).
   */
  receive: permissionProcedure("inventory.manage_purchases")
    .input(
      z.object({
        id: z.number(),
        items: z.array(z.object({ itemId: z.number(), quantity: z.number().min(0) })).min(1),
        notes: z.string().max(2000).optional().or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(purchases).where(eq(purchases.id, input.id)).limit(1);
      const po = found[0];
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
      if (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only an approved (or partially received) order can receive stock.",
        });
      }

      const lines = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, po.id));
      const lineMap = new Map(lines.map((l) => [l.id, l]));

      const arrivals = input.items.filter((i) => i.quantity > 0);
      if (arrivals.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter at least one received quantity." });
      }
      for (const arr of arrivals) {
        const line = lineMap.get(arr.itemId);
        if (!line) throw new TRPCError({ code: "BAD_REQUEST", message: "One of the lines does not belong to this order." });
        const outstanding = line.quantity - line.receivedQty;
        if (arr.quantity > outstanding) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Receiving more than ordered on a line (outstanding: ${outstanding} pack(s)).`,
          });
        }
      }

      const newStatus = await db.transaction(async (tx) => {
        for (const arr of arrivals) {
          const line = lineMap.get(arr.itemId)!;
          const newReceived = Number((line.receivedQty + arr.quantity).toFixed(3));
          await tx.update(purchaseItems).set({ receivedQty: newReceived }).where(eq(purchaseItems.id, line.id));
          await applyMovement(tx, {
            productId: line.productId,
            movementType: "PURCHASE_IN",
            quantity: arr.quantity,
            referenceType: "PURCHASE",
            referenceId: po.id,
            reason: `Received against ${po.reference}`,
            notes: input.notes || null,
            performedBy: ctx.user.id,
          });
          line.receivedQty = newReceived;
        }

        const fullyReceived = [...lineMap.values()].every((l) => l.receivedQty >= l.quantity);
        const status = fullyReceived ? ("RECEIVED" as const) : ("PARTIALLY_RECEIVED" as const);
        await tx
          .update(purchases)
          .set({ status, ...(fullyReceived ? { receivedAt: new Date() } : {}) })
          .where(eq(purchases.id, po.id));
        return status;
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "purchase.receive",
        entityType: "PURCHASE",
        entityId: po.id,
        description: `Received ${arrivals.length} line(s) against ${po.reference} — order now ${newStatus}.`,
        afterData: { arrivals: arrivals.map((a) => ({ itemId: a.itemId, quantity: a.quantity })), status: newStatus },
        ...requestMeta(ctx.req),
      });
      return { ok: true, status: newStatus };
    }),

  cancel: permissionProcedure("inventory.manage_purchases")
    .input(z.object({ id: z.number(), reason: z.string().min(3, "Give a reason").max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(purchases).where(eq(purchases.id, input.id)).limit(1);
      const po = found[0];
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
      if (po.status === "RECEIVED" || po.status === "CANCELLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This order can no longer be cancelled." });
      }
      if (po.status === "PARTIALLY_RECEIVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Stock has already been received against this order — it can't be cancelled.",
        });
      }
      await db.update(purchases).set({ status: "CANCELLED" }).where(eq(purchases.id, po.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "purchase.cancel",
        entityType: "PURCHASE",
        entityId: po.id,
        description: `Cancelled purchase order ${po.reference} — ${input.reason}.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),
});
