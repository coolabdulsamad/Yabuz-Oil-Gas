import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { categories, productImages, products, settings, suppliers } from "@db/schema";
import { PACK_TYPES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { getSettingNumber } from "../services/settings.service";

/**
 * YABUZ OIL & GAS — products & categories router
 * The catalog: pack config, dual pricing (producer cost / marketer sell),
 * images via Cloudinary. Stock balances change only through stock
 * movements (Step 6) — never by editing the product.
 *
 * Cost prices and margins are stripped server-side for viewers without
 * the prices.view_cost permission.
 */

/** All price fields — used to detect price edits on update. */
const PRICE_FIELDS = ["costCartonPrice", "costUnitPrice", "sellCartonPrice", "sellUnitPrice"] as const;

/** Producer (cost) prices — hidden without prices.view_cost. Sell prices stay visible to all staff. */
const COST_FIELDS = ["costCartonPrice", "costUnitPrice"] as const;

function stripCosts<T extends Record<(typeof COST_FIELDS)[number], number>>(row: T, canViewCost: boolean): T {
  if (canViewCost) return row;
  // Runtime nulls — the client renders "—" / "hidden" for these.
  const copy: Record<string, unknown> = { ...row };
  for (const f of COST_FIELDS) copy[f] = null;
  return copy as T;
}

const productInput = z.object({
  name: z.string().min(3, "Product name is required").max(255),
  description: z.string().max(4000).optional().or(z.literal("")),
  categoryId: z.number(),
  supplierId: z.number().nullable().optional(),
  packType: z.enum(PACK_TYPES),
  packDescription: z.string().min(1, "Describe the pack, e.g. 1LTS (12 GALLONS)").max(120),
  unitsPerPack: z.number().positive("Must be greater than zero"),
  unitLabel: z.string().min(1).max(40),
  volumePerUnit: z.number().positive().nullable().optional(),
  costCartonPrice: z.number().min(0),
  costUnitPrice: z.number().min(0),
  sellCartonPrice: z.number().min(0),
  sellUnitPrice: z.number().min(0),
  allowUnitSales: z.boolean(),
  reorderLevel: z.number().min(0),
  storeLocation: z.string().max(80).optional().or(z.literal("")),
  barcode: z.string().max(64).optional().or(z.literal("")),
});

const categoryInput = z.object({
  code: z.string().min(1).max(10).regex(/^[A-Z0-9-]+$/, "Uppercase letters/numbers only"),
  name: z.string().min(2).max(160),
  description: z.string().max(1000).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).default(0),
});

export const productsRouter = createRouter({
  /* ------------------------------ Catalog ------------------------------ */

  list: permissionProcedure("products.view")
    .input(
      z
        .object({
          search: z.string().optional(),
          categoryId: z.number().optional(),
          status: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const canViewCost = ctx.permissions.has("prices.view_cost");

      const conditions = [];
      if (input?.search?.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(or(like(products.name, q), like(products.sku, q), like(products.barcode, q)));
      }
      if (input?.categoryId) conditions.push(eq(products.categoryId, input.categoryId));
      if (input?.status) conditions.push(eq(products.status, input.status));

      const rows = await db
        .select({
          product: products,
          categoryName: categories.name,
          categoryCode: categories.code,
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(categories.sortOrder), asc(products.name));

      return rows.map((r) => ({
        ...stripCosts(r.product, canViewCost),
        categoryName: r.categoryName,
        categoryCode: r.categoryCode,
      }));
    }),

  getById: permissionProcedure("products.view")
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const canViewCost = ctx.permissions.has("prices.view_cost");

      const rows = await db
        .select({
          product: products,
          categoryName: categories.name,
          categoryCode: categories.code,
          supplierName: suppliers.name,
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(eq(products.id, input.id))
        .limit(1);

      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      const images = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, input.id))
        .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.id));

      return {
        ...stripCosts(row.product, canViewCost),
        categoryName: row.categoryName,
        categoryCode: row.categoryCode,
        supplierName: row.supplierName,
        images,
        canViewCost,
      };
    }),

  /* ---------------------------- Create / edit --------------------------- */

  create: permissionProcedure("products.create")
    .input(productInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const cat = await db.select().from(categories).where(eq(categories.id, input.categoryId)).limit(1);
      if (!cat[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid category." });

      if (input.barcode) {
        const dup = await db.select({ id: products.id }).from(products).where(eq(products.barcode, input.barcode)).limit(1);
        if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "That barcode is already used by another product." });
      }

      // Temporary SKU (unique), replaced with the category-based one after insert.
      const tempSku = `TMP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      // Settings → Inventory: fall back to the company-wide default reorder level
      // when the creator left it at 0.
      const defaultReorder = await getSettingNumber(db, "inventory.low_stock_default", 0);
      const reorderLevel = input.reorderLevel > 0 ? input.reorderLevel : defaultReorder;
      const [{ id }] = await db
        .insert(products)
        .values({
          sku: tempSku,
          barcode: input.barcode || null,
          name: input.name.trim(),
          description: input.description || null,
          categoryId: input.categoryId,
          supplierId: input.supplierId ?? null,
          packType: input.packType,
          packDescription: input.packDescription.trim(),
          unitsPerPack: input.unitsPerPack,
          unitLabel: input.unitLabel.trim().toUpperCase(),
          volumePerUnit: input.volumePerUnit ?? null,
          costCartonPrice: input.costCartonPrice,
          costUnitPrice: input.costUnitPrice,
          sellCartonPrice: input.sellCartonPrice,
          sellUnitPrice: input.sellUnitPrice,
          allowUnitSales: input.allowUnitSales,
          reorderLevel,
          storeLocation: input.storeLocation || null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .$returningId();

      const sku = `${cat[0].code}-${String(id).padStart(3, "0")}`;
      await db.update(products).set({ sku }).where(eq(products.id, id));

      await logAudit({
        actorId: ctx.user.id,
        action: "product.create",
        entityType: "PRODUCT",
        entityId: id,
        description: `Created product "${input.name}" (${sku}).`,
        afterData: { ...input, sku },
        ...requestMeta(ctx.req),
      });

      return { ok: true, id, sku };
    }),

  update: permissionProcedure("products.edit")
    .input(productInput.extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(products).where(eq(products.id, input.id)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      // Price edits are a privileged action: require prices.manage.
      const priceChanged = PRICE_FIELDS.some((f) => Number(existing[f]) !== input[f]);
      if (priceChanged && !ctx.permissions.has("prices.manage")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Changing prices requires the price-list permission (prices.manage).",
        });
      }

      if (input.barcode && input.barcode !== existing.barcode) {
        const dup = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.barcode, input.barcode), sql`${products.id} != ${input.id}`))
          .limit(1);
        if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "That barcode is already used by another product." });
      }

      await db
        .update(products)
        .set({
          barcode: input.barcode || null,
          name: input.name.trim(),
          description: input.description || null,
          categoryId: input.categoryId,
          supplierId: input.supplierId ?? null,
          packType: input.packType,
          packDescription: input.packDescription.trim(),
          unitsPerPack: input.unitsPerPack,
          unitLabel: input.unitLabel.trim().toUpperCase(),
          volumePerUnit: input.volumePerUnit ?? null,
          costCartonPrice: input.costCartonPrice,
          costUnitPrice: input.costUnitPrice,
          sellCartonPrice: input.sellCartonPrice,
          sellUnitPrice: input.sellUnitPrice,
          allowUnitSales: input.allowUnitSales,
          reorderLevel: input.reorderLevel,
          storeLocation: input.storeLocation || null,
          updatedBy: ctx.user.id,
        })
        .where(eq(products.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "product.update",
        entityType: "PRODUCT",
        entityId: input.id,
        description: `Updated product "${existing.name}" (${existing.sku})${priceChanged ? " — prices changed" : ""}.`,
        beforeData: {
          name: existing.name,
          costCartonPrice: existing.costCartonPrice,
          sellCartonPrice: existing.sellCartonPrice,
          reorderLevel: existing.reorderLevel,
        },
        afterData: {
          name: input.name,
          costCartonPrice: input.costCartonPrice,
          sellCartonPrice: input.sellCartonPrice,
          reorderLevel: input.reorderLevel,
        },
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),

  /** Activate / deactivate (selling visibility). */
  setStatus: permissionProcedure("products.edit")
    .input(z.object({ id: z.number(), status: z.enum(["ACTIVE", "INACTIVE"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(products).where(eq(products.id, input.id)).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      await db.update(products).set({ status: input.status, updatedBy: ctx.user.id }).where(eq(products.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: input.status === "ACTIVE" ? "product.activate" : "product.deactivate",
        entityType: "PRODUCT",
        entityId: input.id,
        description: `${input.status === "ACTIVE" ? "Activated" : "Deactivated"} product "${found[0].name}".`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /** Discontinue (soft delete — history is preserved). */
  discontinue: permissionProcedure("products.delete")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(products).where(eq(products.id, input.id)).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      await db.update(products).set({ status: "DISCONTINUED", updatedBy: ctx.user.id }).where(eq(products.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "product.discontinue",
        entityType: "PRODUCT",
        entityId: input.id,
        description: `Discontinued product "${found[0].name}" (${found[0].sku}).`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /* ------------------------------ Categories ---------------------------- */

  listCategories: permissionProcedure("products.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    const counts = await db
      .select({ categoryId: products.categoryId, value: count() })
      .from(products)
      .where(ne(products.status, "DISCONTINUED"))
      .groupBy(products.categoryId);
    const countMap = new Map(counts.map((c) => [c.categoryId, c.value]));
    return rows.map((c) => ({ ...c, productCount: countMap.get(c.id) ?? 0 }));
  }),

  createCategory: permissionProcedure("products.manage_categories")
    .input(categoryInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dup = await db
        .select({ id: categories.id })
        .from(categories)
        .where(or(eq(categories.code, input.code), eq(categories.name, input.name.trim())))
        .limit(1);
      if (dup[0]) throw new TRPCError({ code: "CONFLICT", message: "A category with that code or name already exists." });

      const [{ id }] = await db
        .insert(categories)
        .values({
          code: input.code.toUpperCase(),
          name: input.name.trim(),
          description: input.description || null,
          sortOrder: input.sortOrder,
        })
        .$returningId();

      await logAudit({
        actorId: ctx.user.id,
        action: "category.create",
        entityType: "CATEGORY",
        entityId: id,
        description: `Created category "${input.name}" (${input.code.toUpperCase()}).`,
        afterData: input,
        ...requestMeta(ctx.req),
      });
      return { ok: true, id };
    }),

  updateCategory: permissionProcedure("products.manage_categories")
    .input(categoryInput.extend({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(categories).where(eq(categories.id, input.id)).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found." });

      await db
        .update(categories)
        .set({
          code: input.code.toUpperCase(),
          name: input.name.trim(),
          description: input.description || null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .where(eq(categories.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "category.update",
        entityType: "CATEGORY",
        entityId: input.id,
        description: `Updated category "${input.name}".`,
        beforeData: { name: found[0].name, code: found[0].code, isActive: found[0].isActive },
        afterData: { name: input.name, code: input.code, isActive: input.isActive },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /* -------------------------------- Images ------------------------------ */

  /** Cloudinary config for unsigned browser uploads (any staff member). */
  uploadConfig: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db.select().from(settings).where(
      or(
        eq(settings.key, "cloudinary.cloud_name"),
        eq(settings.key, "cloudinary.upload_preset"),
        eq(settings.key, "cloudinary.folder"),
      ),
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ? String(JSON.parse(r.value)) : "";
    const cloudName = map["cloudinary.cloud_name"] ?? "";
    const uploadPreset = map["cloudinary.upload_preset"] ?? "";
    const folder = map["cloudinary.folder"] ?? "";
    return { cloudName, uploadPreset, folder, configured: !!(cloudName && uploadPreset) };
  }),

  addImage: permissionProcedure("products.edit")
    .input(
      z.object({
        productId: z.number(),
        url: z.string().url().max(500),
        publicId: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, input.productId)).limit(1);
      if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });

      const existing = await db.select().from(productImages).where(eq(productImages.productId, input.productId));
      const isPrimary = existing.length === 0;

      const [{ id }] = await db
        .insert(productImages)
        .values({
          productId: input.productId,
          url: input.url,
          publicId: input.publicId ?? null,
          sortOrder: existing.length,
          isPrimary,
        })
        .$returningId();

      if (isPrimary) {
        await db.update(products).set({ primaryImageUrl: input.url }).where(eq(products.id, input.productId));
      }

      await logAudit({
        actorId: ctx.user.id,
        action: "product.add_image",
        entityType: "PRODUCT",
        entityId: input.productId,
        description: `Added an image to "${found[0].name}".`,
        afterData: { url: input.url },
        ...requestMeta(ctx.req),
      });
      return { ok: true, id, isPrimary };
    }),

  removeImage: permissionProcedure("products.edit")
    .input(z.object({ imageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(productImages).where(eq(productImages.id, input.imageId)).limit(1);
      const img = found[0];
      if (!img) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found." });

      await db.delete(productImages).where(eq(productImages.id, input.imageId));

      // Keep the primary flag consistent after a removal.
      if (img.isPrimary) {
        const next = await db
          .select()
          .from(productImages)
          .where(eq(productImages.productId, img.productId))
          .orderBy(asc(productImages.sortOrder), asc(productImages.id))
          .limit(1);
        await db
          .update(products)
          .set({ primaryImageUrl: next[0]?.url ?? null })
          .where(eq(products.id, img.productId));
        if (next[0]) {
          await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, next[0].id));
        }
      }

      await logAudit({
        actorId: ctx.user.id,
        action: "product.remove_image",
        entityType: "PRODUCT",
        entityId: img.productId,
        description: `Removed an image from product #${img.productId}.`,
        beforeData: { url: img.url },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  setPrimaryImage: permissionProcedure("products.edit")
    .input(z.object({ imageId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const found = await db.select().from(productImages).where(eq(productImages.id, input.imageId)).limit(1);
      const img = found[0];
      if (!img) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found." });

      await db.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, img.productId));
      await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, img.id));
      await db.update(products).set({ primaryImageUrl: img.url }).where(eq(products.id, img.productId));
      return { ok: true };
    }),
});
