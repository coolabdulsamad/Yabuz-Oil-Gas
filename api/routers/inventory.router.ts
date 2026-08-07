import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  categories,
  products,
  stockCountItems,
  stockCounts,
  stockMovements,
  suppliers,
  users,
} from "@db/schema";
import { STOCK_MOVEMENT_TYPES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { applyMovement } from "../services/inventory.service";

/**
 * YABUZ OIL & GAS — inventory router
 * Stock overview & valuation, the movement ledger, supplies from Polar,
 * manual stock-out (damage/write-off), adjustments, physical stock
 * counts, low-stock list and supplier records.
 *
 * Balances change ONLY through applyMovement() (stock_movements ledger).
 */

const COST_FIELDS = ["costCartonPrice", "costUnitPrice"] as const;
function stripCosts<T extends Record<(typeof COST_FIELDS)[number], number>>(row: T, canViewCost: boolean): T {
  if (canViewCost) return row;
  const copy: Record<string, unknown> = { ...row };
  for (const f of COST_FIELDS) copy[f] = null;
  return copy as T;
}

const supplierInput = z.object({
  name: z.string().min(2, "Supplier name is required").max(160),
  contactPerson: z.string().max(160).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().email("Invalid email").max(160).optional().or(z.literal("")),
  address: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const inventoryRouter = createRouter({
  /* ------------------------------ OVERVIEW ------------------------------ */

  /** Stock position for every product + valuation totals. */
  overview: permissionProcedure("inventory.view").query(async ({ ctx }) => {
    const db = getDb();
    const canViewCost = ctx.permissions.has("prices.view_cost");

    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        packType: products.packType,
        packDescription: products.packDescription,
        unitsPerPack: products.unitsPerPack,
        unitLabel: products.unitLabel,
        status: products.status,
        currentStock: products.currentStock,
        reorderLevel: products.reorderLevel,
        storeLocation: products.storeLocation,
        costCartonPrice: products.costCartonPrice,
        costUnitPrice: products.costUnitPrice,
        sellCartonPrice: products.sellCartonPrice,
        categoryName: categories.name,
        supplierName: suppliers.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(eq(products.status, "ACTIVE"))
      .orderBy(asc(products.name));

    const items = rows.map((r) => {
      const clean = stripCosts(r, canViewCost);
      return {
        ...clean,
        stockValueCost: canViewCost ? Number((r.currentStock * r.costCartonPrice).toFixed(2)) : null,
        stockValueSell: Number((r.currentStock * r.sellCartonPrice).toFixed(2)),
        isLow: r.reorderLevel > 0 && r.currentStock <= r.reorderLevel,
        isOut: r.currentStock <= 0,
      };
    });

    return {
      items,
      stats: {
        totalProducts: items.length,
        inStock: items.filter((i) => i.currentStock > 0).length,
        lowStock: items.filter((i) => i.isLow).length,
        outOfStock: items.filter((i) => i.isOut).length,
        totalValueCost: canViewCost
          ? Number(items.reduce((s, i) => s + (i.stockValueCost ?? 0), 0).toFixed(2))
          : null,
        totalValueSell: Number(items.reduce((s, i) => s + i.stockValueSell, 0).toFixed(2)),
      },
    };
  }),

  /** Products at or below reorder level. */
  lowStock: permissionProcedure("inventory.view").query(async ({ ctx }) => {
    const db = getDb();
    const canViewCost = ctx.permissions.has("prices.view_cost");
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        packDescription: products.packDescription,
        currentStock: products.currentStock,
        reorderLevel: products.reorderLevel,
        sellCartonPrice: products.sellCartonPrice,
        costCartonPrice: products.costCartonPrice,
        costUnitPrice: products.costUnitPrice,
        categoryName: categories.name,
        supplierName: suppliers.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(and(eq(products.status, "ACTIVE"), sql`${products.currentStock} <= ${products.reorderLevel}`))
      .orderBy(asc(products.currentStock));
    return rows.map((r) => stripCosts(r, canViewCost));
  }),

  /* --------------------------- MOVEMENT LEDGER --------------------------- */

  movements: permissionProcedure("inventory.view")
    .input(
      z.object({
        productId: z.number().optional(),
        movementType: z.enum(STOCK_MOVEMENT_TYPES).optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(), // YYYY-MM-DD
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.productId) conds.push(eq(stockMovements.productId, input.productId));
      if (input.movementType) conds.push(eq(stockMovements.movementType, input.movementType));
      if (input.dateFrom) conds.push(gte(stockMovements.createdAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input.dateTo) conds.push(lte(stockMovements.createdAt, new Date(`${input.dateTo}T23:59:59`)));
      if (input.search) {
        const q = `%${input.search}%`;
        conds.push(or(like(products.name, q), like(products.sku, q), like(stockMovements.reason, q)));
      }

      return db
        .select({
          id: stockMovements.id,
          movementType: stockMovements.movementType,
          quantity: stockMovements.quantity,
          balanceAfter: stockMovements.balanceAfter,
          referenceType: stockMovements.referenceType,
          referenceId: stockMovements.referenceId,
          reason: stockMovements.reason,
          notes: stockMovements.notes,
          createdAt: stockMovements.createdAt,
          productId: products.id,
          productName: products.name,
          sku: products.sku,
          packDescription: products.packDescription,
          performedByName: users.fullName,
        })
        .from(stockMovements)
        .innerJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(users, eq(stockMovements.performedBy, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(input.limit);
    }),

  /* ----------------------- SUPPLIES / STOCK-IN / OUT ----------------------- */

  /** Receive a supply (typically from Polar) straight into stock. */
  recordSupply: permissionProcedure("inventory.stock_in")
    .input(
      z.object({
        productId: z.number(),
        quantity: z.number().positive("Quantity must be greater than zero"),
        reason: z.string().max(255).optional().or(z.literal("")),
        notes: z.string().max(2000).optional().or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) =>
        applyMovement(tx, {
          productId: input.productId,
          movementType: "SUPPLY_IN",
          quantity: input.quantity,
          referenceType: "SUPPLY",
          reason: input.reason || "Supply received",
          notes: input.notes || null,
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.supply",
        entityType: "STOCK_MOVEMENT",
        entityId: result.movementId,
        description: `Recorded supply of ${input.quantity} pack(s) of "${result.product.name}" — balance now ${result.balanceAfter}.`,
        afterData: { productId: input.productId, quantity: input.quantity, balanceAfter: result.balanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, balanceAfter: result.balanceAfter };
    }),

  /** Stock leaving the store without a sale: damage/leak write-off, manual out. */
  recordStockOut: permissionProcedure("inventory.stock_out")
    .input(
      z.object({
        productId: z.number(),
        quantity: z.number().positive("Quantity must be greater than zero"),
        kind: z.enum(["DAMAGE_OUT", "ADJUSTMENT_OUT"]).default("DAMAGE_OUT"),
        reason: z.string().min(3, "Give a reason for this stock-out").max(255),
        notes: z.string().max(2000).optional().or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) =>
        applyMovement(tx, {
          productId: input.productId,
          movementType: input.kind,
          quantity: -Math.abs(input.quantity),
          referenceType: input.kind === "DAMAGE_OUT" ? "DAMAGE" : "ADJUSTMENT",
          reason: input.reason,
          notes: input.notes || null,
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.stock_out",
        entityType: "STOCK_MOVEMENT",
        entityId: result.movementId,
        description: `Stock-out (${input.kind === "DAMAGE_OUT" ? "damage" : "manual"}) of ${input.quantity} pack(s) of "${result.product.name}" — ${input.reason}.`,
        afterData: { productId: input.productId, quantity: -input.quantity, balanceAfter: result.balanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, balanceAfter: result.balanceAfter };
    }),

  /** Correct a balance (positive or negative). Reason is mandatory. */
  adjust: permissionProcedure("inventory.adjust")
    .input(
      z.object({
        productId: z.number(),
        direction: z.enum(["IN", "OUT"]),
        quantity: z.number().positive("Quantity must be greater than zero"),
        reason: z.string().min(3, "Give a reason for this adjustment").max(255),
        notes: z.string().max(2000).optional().or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const signed = input.direction === "IN" ? input.quantity : -input.quantity;
      const result = await db.transaction(async (tx) =>
        applyMovement(tx, {
          productId: input.productId,
          movementType: input.direction === "IN" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantity: signed,
          referenceType: "ADJUSTMENT",
          reason: input.reason,
          notes: input.notes || null,
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.adjust",
        entityType: "STOCK_MOVEMENT",
        entityId: result.movementId,
        description: `Adjusted "${result.product.name}" by ${signed > 0 ? "+" : ""}${signed} pack(s) — ${input.reason}. Balance now ${result.balanceAfter}.`,
        afterData: { productId: input.productId, quantity: signed, balanceAfter: result.balanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, balanceAfter: result.balanceAfter };
    }),

  /* ------------------------------ STOCK COUNTS ------------------------------ */

  listCounts: permissionProcedure("inventory.view").query(async () => {
    const db = getDb();
    const countsRows = await db
      .select({
        id: stockCounts.id,
        reference: stockCounts.reference,
        status: stockCounts.status,
        notes: stockCounts.notes,
        startedAt: stockCounts.startedAt,
        completedAt: stockCounts.completedAt,
        startedByName: users.fullName,
      })
      .from(stockCounts)
      .leftJoin(users, eq(stockCounts.startedBy, users.id))
      .orderBy(desc(stockCounts.startedAt));

    const itemCounts = await db
      .select({ countId: stockCountItems.countId, value: count() })
      .from(stockCountItems)
      .groupBy(stockCountItems.countId);
    const countMap = new Map(itemCounts.map((r) => [r.countId, r.value]));

    return countsRows.map((c) => ({ ...c, itemCount: countMap.get(c.id) ?? 0 }));
  }),

  /** Start a physical count — snapshots expected balances for every active product. */
  startCount: permissionProcedure("inventory.stock_count")
    .input(z.object({ notes: z.string().max(2000).optional().or(z.literal("")) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const open = await db
        .select({ id: stockCounts.id })
        .from(stockCounts)
        .where(eq(stockCounts.status, "IN_PROGRESS"))
        .limit(1);
      if (open[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A stock count is already in progress — complete or cancel it first.",
        });
      }

      const active = await db
        .select({ id: products.id, currentStock: products.currentStock, sellUnitPrice: products.sellUnitPrice })
        .from(products)
        .where(eq(products.status, "ACTIVE"));

      const countId = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(stockCounts)
          .values({ reference: "TMP", status: "IN_PROGRESS", notes: input.notes || null, startedBy: ctx.user.id })
          .$returningId();
        const reference = `SC-${String(id).padStart(6, "0")}`;
        await tx.update(stockCounts).set({ reference }).where(eq(stockCounts.id, id));
        for (const p of active) {
          await tx.insert(stockCountItems).values({
            countId: id,
            productId: p.id,
            expectedQty: p.currentStock,
            unitPrice: p.sellUnitPrice,
          });
        }
        return id;
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.count_start",
        entityType: "STOCK_COUNT",
        entityId: countId,
        description: `Started stock count SC-${String(countId).padStart(6, "0")} covering ${active.length} product(s).`,
        ...requestMeta(ctx.req),
      });
      return { ok: true, id: countId };
    }),

  getCount: permissionProcedure("inventory.view")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const found = await db
        .select({
          id: stockCounts.id,
          reference: stockCounts.reference,
          status: stockCounts.status,
          notes: stockCounts.notes,
          startedAt: stockCounts.startedAt,
          completedAt: stockCounts.completedAt,
          startedByName: users.fullName,
        })
        .from(stockCounts)
        .leftJoin(users, eq(stockCounts.startedBy, users.id))
        .where(eq(stockCounts.id, input.id))
        .limit(1);
      const countRow = found[0];
      if (!countRow) throw new TRPCError({ code: "NOT_FOUND", message: "Stock count not found." });

      const items = await db
        .select({
          id: stockCountItems.id,
          productId: stockCountItems.productId,
          expectedQty: stockCountItems.expectedQty,
          countedQty: stockCountItems.countedQty,
          variance: stockCountItems.variance,
          unitPrice: stockCountItems.unitPrice,
          productSellUnitPrice: products.sellUnitPrice, // fallback for counts started before pricing
          notes: stockCountItems.notes,
          productName: products.name,
          sku: products.sku,
          packDescription: products.packDescription,
          currentStock: products.currentStock,
        })
        .from(stockCountItems)
        .innerJoin(products, eq(stockCountItems.productId, products.id))
        .where(eq(stockCountItems.countId, countRow.id))
        .orderBy(asc(products.name));

      return { ...countRow, items };
    }),

  /** Enter counted quantities (bulk). Only while IN_PROGRESS. */
  updateCountItems: permissionProcedure("inventory.stock_count")
    .input(
      z.object({
        countId: z.number(),
        items: z
          .array(
            z.object({
              itemId: z.number(),
              countedQty: z.number().min(0),
              notes: z.string().max(255).optional().or(z.literal("")),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const found = await db.select().from(stockCounts).where(eq(stockCounts.id, input.countId)).limit(1);
      const countRow = found[0];
      if (!countRow) throw new TRPCError({ code: "NOT_FOUND", message: "Stock count not found." });
      if (countRow.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This count is no longer in progress." });
      }

      await db.transaction(async (tx) => {
        for (const item of input.items) {
          const rows = await tx
            .select()
            .from(stockCountItems)
            .where(and(eq(stockCountItems.id, item.itemId), eq(stockCountItems.countId, input.countId)))
            .limit(1);
          const existing = rows[0];
          if (!existing) continue;
          await tx
            .update(stockCountItems)
            .set({
              countedQty: item.countedQty,
              variance: Number((item.countedQty - existing.expectedQty).toFixed(3)),
              notes: item.notes || null,
            })
            .where(eq(stockCountItems.id, item.itemId));
        }
      });
      return { ok: true };
    }),

  /** Complete the count — applies variances as COUNT_ADJUST movements. */
  completeCount: permissionProcedure("inventory.stock_count")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(stockCounts).where(eq(stockCounts.id, input.id)).limit(1);
      const countRow = found[0];
      if (!countRow) throw new TRPCError({ code: "NOT_FOUND", message: "Stock count not found." });
      if (countRow.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This count is no longer in progress." });
      }

      const items = await db
        .select()
        .from(stockCountItems)
        .where(eq(stockCountItems.countId, countRow.id));
      const counted = items.filter((i) => i.countedQty !== null);

      let adjusted = 0;
      await db.transaction(async (tx) => {
        for (const item of counted) {
          const variance = Number((item.countedQty! - item.expectedQty).toFixed(3));
          if (variance === 0) continue;
          await applyMovement(tx, {
            productId: item.productId,
            movementType: "COUNT_ADJUST",
            quantity: variance,
            referenceType: "COUNT",
            referenceId: countRow.id,
            reason: `Stock count ${countRow.reference} variance`,
            notes: item.notes,
            performedBy: ctx.user.id,
          });
          adjusted++;
        }
        await tx
          .update(stockCounts)
          .set({ status: "COMPLETED", completedAt: new Date(), approvedBy: ctx.user.id })
          .where(eq(stockCounts.id, countRow.id));
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.count_complete",
        entityType: "STOCK_COUNT",
        entityId: countRow.id,
        description: `Completed stock count ${countRow.reference} — ${counted.length} counted, ${adjusted} variance adjustment(s) applied.`,
        afterData: { counted: counted.length, adjusted },
        ...requestMeta(ctx.req),
      });
      return { ok: true, adjusted };
    }),

  cancelCount: permissionProcedure("inventory.stock_count")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(stockCounts).where(eq(stockCounts.id, input.id)).limit(1);
      const countRow = found[0];
      if (!countRow) throw new TRPCError({ code: "NOT_FOUND", message: "Stock count not found." });
      if (countRow.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only an in-progress count can be cancelled." });
      }
      await db.update(stockCounts).set({ status: "CANCELLED" }).where(eq(stockCounts.id, countRow.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.count_cancel",
        entityType: "STOCK_COUNT",
        entityId: countRow.id,
        description: `Cancelled stock count ${countRow.reference}.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /* ------------------------------- SUPPLIERS ------------------------------- */

  listSuppliers: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
    const productCounts = await db
      .select({ supplierId: products.supplierId, value: count() })
      .from(products)
      .groupBy(products.supplierId);
    const countMap = new Map(productCounts.map((r) => [r.supplierId, r.value]));
    return rows.map((s) => ({ ...s, productCount: countMap.get(s.id) ?? 0 }));
  }),

  createSupplier: permissionProcedure("inventory.manage_suppliers")
    .input(supplierInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dup = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.name, input.name.trim()))
        .limit(1);
      if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "A supplier with that name already exists." });

      const [{ id }] = await db
        .insert(suppliers)
        .values({
          name: input.name.trim().toUpperCase(),
          contactPerson: input.contactPerson || null,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          notes: input.notes || null,
        })
        .$returningId();

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.supplier_create",
        entityType: "SUPPLIER",
        entityId: id,
        description: `Created supplier "${input.name.trim().toUpperCase()}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true, id };
    }),

  updateSupplier: permissionProcedure("inventory.manage_suppliers")
    .input(z.object({ id: z.number(), data: supplierInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(suppliers).where(eq(suppliers.id, input.id)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found." });

      await db
        .update(suppliers)
        .set({
          name: input.data.name.trim().toUpperCase(),
          contactPerson: input.data.contactPerson || null,
          phone: input.data.phone || null,
          email: input.data.email || null,
          address: input.data.address || null,
          notes: input.data.notes || null,
        })
        .where(eq(suppliers.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.supplier_update",
        entityType: "SUPPLIER",
        entityId: input.id,
        description: `Updated supplier "${input.data.name.trim().toUpperCase()}".`,
        beforeData: existing as unknown as Record<string, unknown>,
        afterData: input.data,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  setSupplierActive: permissionProcedure("inventory.manage_suppliers")
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(suppliers).where(eq(suppliers.id, input.id)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found." });
      await db.update(suppliers).set({ isActive: input.isActive }).where(eq(suppliers.id, input.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "inventory.supplier_status",
        entityType: "SUPPLIER",
        entityId: input.id,
        description: `${input.isActive ? "Reactivated" : "Deactivated"} supplier "${existing.name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),
});
