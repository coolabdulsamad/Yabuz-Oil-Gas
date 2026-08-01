import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { createRouter } from "../middleware";
import { anyPermissionProcedure, permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { priceListItems, priceLists, products } from "@db/schema";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — batch price lists router
 * Mirrors the paper workflow: Polar sends a new list → admin drafts a
 * batch (cloned from the current one), edits the new producer/marketer
 * prices, then publishes it. Publishing stamps every listed product with
 * the new prices and freezes the batch as the historical record.
 * Only one list is active at a time; published lists become immutable.
 */

const viewPrices = () => anyPermissionProcedure(["prices.view_cost", "prices.manage"]);

export const priceListsRouter = createRouter({
  list: viewPrices().query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(priceLists)
      .orderBy(desc(priceLists.isActive), desc(priceLists.createdAt));
    const counts = await db
      .select({ priceListId: priceListItems.priceListId, value: count() })
      .from(priceListItems)
      .groupBy(priceListItems.priceListId);
    const countMap = new Map(counts.map((c) => [c.priceListId, c.value]));
    return rows.map((l) => ({ ...l, itemCount: countMap.get(l.id) ?? 0 }));
  }),

  getById: viewPrices()
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const found = await db.select().from(priceLists).where(eq(priceLists.id, input.id)).limit(1);
      const list = found[0];
      if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Price list not found." });

      const items = await db
        .select({
          item: priceListItems,
          productName: products.name,
          sku: products.sku,
          packType: products.packType,
          packDescription: products.packDescription,
          unitsPerPack: products.unitsPerPack,
          unitLabel: products.unitLabel,
          productStatus: products.status,
          currentSellCarton: products.sellCartonPrice,
        })
        .from(priceListItems)
        .innerJoin(products, eq(priceListItems.productId, products.id))
        .where(eq(priceListItems.priceListId, input.id))
        .orderBy(asc(products.name));

      return {
        ...list,
        items: items.map((r) => ({ ...r.item, ...{
          productName: r.productName,
          sku: r.sku,
          packType: r.packType,
          packDescription: r.packDescription,
          unitsPerPack: r.unitsPerPack,
          unitLabel: r.unitLabel,
          productStatus: r.productStatus,
          currentSellCarton: r.currentSellCarton,
        } })),
      };
    }),

  /** Draft a new batch, cloning items from the active list (or a chosen source). */
  create: permissionProcedure("prices.manage")
    .input(
      z.object({
        name: z.string().min(2, "Name the batch, e.g. BATCH C").max(60),
        description: z.string().max(1000).optional().or(z.literal("")),
        sourceListId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const dup = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.name, input.name.trim())).limit(1);
      if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "A price list with that name already exists." });

      // Source: explicit, else the active list, else the most recent.
      let sourceId = input.sourceListId;
      if (!sourceId) {
        const active = await db.select().from(priceLists).where(eq(priceLists.isActive, true)).limit(1);
        sourceId = active[0]?.id;
      }
      if (!sourceId) {
        const recent = await db.select().from(priceLists).orderBy(desc(priceLists.createdAt)).limit(1);
        sourceId = recent[0]?.id;
      }

      const [{ id: newListId }] = await db
        .insert(priceLists)
        .values({
          name: input.name.trim().toUpperCase(),
          description: input.description || null,
          isActive: false,
          approvalStatus: "PENDING",
          createdBy: ctx.user.id,
        })
        .$returningId();

      let cloned = 0;
      if (sourceId) {
        const sourceItems = await db.select().from(priceListItems).where(eq(priceListItems.priceListId, sourceId));
        for (const item of sourceItems) {
          await db.insert(priceListItems).values({
            priceListId: newListId,
            productId: item.productId,
            producerCartonPrice: item.producerCartonPrice,
            producerUnitPrice: item.producerUnitPrice,
            marketerCartonPrice: item.marketerCartonPrice,
            marketerUnitPrice: item.marketerUnitPrice,
            cartonGain: item.marketerCartonPrice - item.producerCartonPrice,
            unitGain: item.marketerUnitPrice - item.producerUnitPrice,
            oldPrice: item.marketerCartonPrice,
          });
          cloned++;
        }
      } else {
        // No lists at all yet: seed items from current product prices.
        const allProducts = await db.select().from(products).where(ne(products.status, "DISCONTINUED"));
        for (const p of allProducts) {
          await db.insert(priceListItems).values({
            priceListId: newListId,
            productId: p.id,
            producerCartonPrice: p.costCartonPrice,
            producerUnitPrice: p.costUnitPrice,
            marketerCartonPrice: p.sellCartonPrice,
            marketerUnitPrice: p.sellUnitPrice,
            cartonGain: p.sellCartonPrice - p.costCartonPrice,
            unitGain: p.sellUnitPrice - p.costUnitPrice,
            oldPrice: null,
          });
          cloned++;
        }
      }

      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.create",
        entityType: "PRICE_LIST",
        entityId: newListId,
        description: `Drafted price list "${input.name.toUpperCase()}" with ${cloned} item(s)${sourceId ? ` cloned from list #${sourceId}` : " from current product prices"}.`,
        afterData: { name: input.name, sourceListId: sourceId ?? null, cloned },
        ...requestMeta(ctx.req),
      });

      return { ok: true, id: newListId, cloned };
    }),

  /** Update one item's prices in a DRAFT list (gains recompute automatically). */
  updateItem: permissionProcedure("prices.manage")
    .input(
      z.object({
        itemId: z.number(),
        producerCartonPrice: z.number().min(0),
        producerUnitPrice: z.number().min(0),
        marketerCartonPrice: z.number().min(0),
        marketerUnitPrice: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db
        .select({ item: priceListItems, list: priceLists })
        .from(priceListItems)
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(eq(priceListItems.id, input.itemId))
        .limit(1);
      const row = found[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Price list item not found." });
      if (row.list.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The published list is locked — draft a new batch to change prices." });
      }

      await db
        .update(priceListItems)
        .set({
          producerCartonPrice: input.producerCartonPrice,
          producerUnitPrice: input.producerUnitPrice,
          marketerCartonPrice: input.marketerCartonPrice,
          marketerUnitPrice: input.marketerUnitPrice,
          cartonGain: input.marketerCartonPrice - input.producerCartonPrice,
          unitGain: input.marketerUnitPrice - input.producerUnitPrice,
        })
        .where(eq(priceListItems.id, input.itemId));

      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.update_item",
        entityType: "PRICE_LIST",
        entityId: row.list.id,
        description: `Edited item #${input.itemId} in draft list "${row.list.name}".`,
        beforeData: {
          producerCartonPrice: row.item.producerCartonPrice,
          marketerCartonPrice: row.item.marketerCartonPrice,
        },
        afterData: {
          producerCartonPrice: input.producerCartonPrice,
          marketerCartonPrice: input.marketerCartonPrice,
        },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /** Add a product that isn't in a draft list yet (copies current prices in). */
  addItem: permissionProcedure("prices.manage")
    .input(z.object({ priceListId: z.number(), productId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const listRows = await db.select().from(priceLists).where(eq(priceLists.id, input.priceListId)).limit(1);
      if (!listRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Price list not found." });
      if (listRows[0].isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The published list is locked." });
      }
      const productRows = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
      const p = productRows[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      const dup = await db
        .select({ id: priceListItems.id })
        .from(priceListItems)
        .where(and(eq(priceListItems.priceListId, input.priceListId), eq(priceListItems.productId, input.productId)))
        .limit(1);
      if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "That product is already in this list." });

      await db.insert(priceListItems).values({
        priceListId: input.priceListId,
        productId: input.productId,
        producerCartonPrice: p.costCartonPrice,
        producerUnitPrice: p.costUnitPrice,
        marketerCartonPrice: p.sellCartonPrice,
        marketerUnitPrice: p.sellUnitPrice,
        cartonGain: p.sellCartonPrice - p.costCartonPrice,
        unitGain: p.sellUnitPrice - p.costUnitPrice,
        oldPrice: null,
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.add_item",
        entityType: "PRICE_LIST",
        entityId: input.priceListId,
        description: `Added "${p.name}" to draft list "${listRows[0].name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  removeItem: permissionProcedure("prices.manage")
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db
        .select({ item: priceListItems, list: priceLists })
        .from(priceListItems)
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(eq(priceListItems.id, input.itemId))
        .limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });
      if (found[0].list.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The published list is locked." });
      }
      await db.delete(priceListItems).where(eq(priceListItems.id, input.itemId));
      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.remove_item",
        entityType: "PRICE_LIST",
        entityId: found[0].list.id,
        description: `Removed item #${input.itemId} from draft list "${found[0].list.name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /**
   * Publish a draft: applies its prices to every listed product and makes
   * it the single active list. Product sell prices before publishing are
   * stamped onto items.oldPrice (the sheet's "OLD PRICE" column).
   */
  publish: permissionProcedure("prices.manage")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(priceLists).where(eq(priceLists.id, input.id)).limit(1);
      const list = found[0];
      if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Price list not found." });
      if (list.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "This list is already the published one." });

      const items = await db.select().from(priceListItems).where(eq(priceListItems.priceListId, list.id));
      if (items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "This list has no items to publish." });

      await db.transaction(async (tx) => {
        for (const item of items) {
          const productRows = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
          const p = productRows[0];
          if (!p) continue;

          await tx
            .update(priceListItems)
            .set({ oldPrice: p.sellCartonPrice })
            .where(eq(priceListItems.id, item.id));

          await tx
            .update(products)
            .set({
              costCartonPrice: item.producerCartonPrice,
              costUnitPrice: item.producerUnitPrice,
              sellCartonPrice: item.marketerCartonPrice,
              sellUnitPrice: item.marketerUnitPrice,
              updatedBy: ctx.user.id,
            })
            .where(eq(products.id, p.id));
        }

        await tx.update(priceLists).set({ isActive: false }).where(ne(priceLists.id, list.id));
        await tx
          .update(priceLists)
          .set({
            isActive: true,
            approvalStatus: "APPROVED",
            effectiveFrom: new Date(),
            publishedBy: ctx.user.id,
            publishedAt: new Date(),
          })
          .where(eq(priceLists.id, list.id));
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.publish",
        entityType: "PRICE_LIST",
        entityId: list.id,
        description: `Published price list "${list.name}" — ${items.length} product price(s) updated.`,
        afterData: { items: items.length },
        ...requestMeta(ctx.req),
      });

      return { ok: true, applied: items.length };
    }),

  /** Delete a draft (published lists stay forever as history). */
  deleteDraft: permissionProcedure("prices.manage")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(priceLists).where(eq(priceLists.id, input.id)).limit(1);
      const list = found[0];
      if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Price list not found." });
      if (list.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "The published list can't be deleted — it's the price history." });

      await db.delete(priceListItems).where(eq(priceListItems.priceListId, list.id));
      await db.delete(priceLists).where(eq(priceLists.id, list.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "pricelist.delete",
        entityType: "PRICE_LIST",
        entityId: input.id,
        description: `Deleted draft price list "${list.name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),
});
