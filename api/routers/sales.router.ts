import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { approvalRequests, approvalRequestSteps, customers, products, saleItems, sales, users } from "@db/schema";
import { SALE_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { applyMovement } from "../services/inventory.service";
import { applyCustomerTx } from "../services/customers.service";
import { bumpCustomerStats, finalizeSale, getFlowSteps, submitApproval } from "../services/approvals.service";

/**
 * YABUZ OIL & GAS — sales router
 * POS sales with snapshots, hold/resume, configurable approval chain.
 * Stock and wallet effects happen ONLY at final approval (finalizeSale)
 * or immediately at submission when no SALE approval chain is configured.
 *
 * Payment mode is stamped into notes as [mode:PAY_LATER|CREDIT|DEPOSIT]:
 *   PAY_LATER → completes UNPAID; payments module collects later
 *   CREDIT    → customer's outstanding rises by the grand total
 *   DEPOSIT   → draws from the customer's advance deposit wallet (PAID)
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const PAYMENT_MODES = ["PAY_LATER", "CREDIT", "DEPOSIT"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export function parsePaymentMode(notes: string | null): PaymentMode {
  const m = notes?.match(/\[mode:([A-Z_]+)\]/);
  return m?.[1] === "CREDIT" || m?.[1] === "DEPOSIT" ? m[1] : "PAY_LATER";
}

const lineInput = z.object({
  productId: z.number().int().positive(),
  soldAsUnits: z.boolean().default(false),
  quantity: z.number().positive("Quantity must be greater than zero"),
  /** Leave empty to use the product's current sell price. */
  unitPrice: z.number().min(0).optional(),
  discountAmount: z.number().min(0).default(0),
});

const saleBodyInput = z.object({
  customerId: z.number().int().positive().optional(),
  paymentMode: z.enum(PAYMENT_MODES).default("PAY_LATER"),
  items: z.array(lineInput).min(1, "Add at least one product."),
  saleDiscount: z.number().min(0).default(0),
  discountNote: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
});

interface PreparedLine {
  productId: number;
  productName: string;
  sku: string;
  packDescription: string;
  soldAsUnits: boolean;
  quantity: number;
  packsDeducted: number;
  unitPrice: number;
  costPrice: number;
  discountAmount: number;
  lineTotal: number;
}

/** Validates items, applies price/discount permission gates, computes totals. */
async function prepareSaleLines(
  db: Db,
  input: z.infer<typeof saleBodyInput>,
  has: (key: string) => boolean,
): Promise<{ lines: PreparedLine[]; subtotal: number; discountTotal: number; grandTotal: number }> {
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const productRows = await db.select().from(products).where(inArray(products.id, ids));
  const byId = new Map(productRows.map((p) => [p.id, p]));

  let priceOverridden = false;
  let lineDiscounted = false;
  const lines: PreparedLine[] = input.items.map((item, idx) => {
    const product = byId.get(item.productId);
    if (!product) throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${idx + 1}: product not found.` });
    if (product.status !== "ACTIVE") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `"${product.name}" is not active and can't be sold.` });
    }
    if (item.soldAsUnits && !product.allowUnitSales) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `"${product.name}" is sold in whole ${product.packType.toLowerCase()}s only.` });
    }
    const defaultPrice = item.soldAsUnits ? product.sellUnitPrice : product.sellCartonPrice;
    const unitPrice = item.unitPrice ?? defaultPrice;
    if (unitPrice !== defaultPrice) priceOverridden = true;
    if (item.discountAmount > 0) lineDiscounted = true;
    const lineTotal = Number((item.quantity * unitPrice - item.discountAmount).toFixed(2));
    if (lineTotal < 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${idx + 1}: discount exceeds the line amount.` });
    }
    const packsDeducted = item.soldAsUnits
      ? Number((item.quantity / product.unitsPerPack).toFixed(3))
      : Number(item.quantity.toFixed(3));
    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      packDescription: product.packDescription,
      soldAsUnits: item.soldAsUnits,
      quantity: item.quantity,
      packsDeducted,
      unitPrice,
      costPrice: item.soldAsUnits ? product.costUnitPrice : product.costCartonPrice,
      discountAmount: item.discountAmount,
      lineTotal,
    };
  });

  if (priceOverridden && !has("sales.override_price")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to override selling prices." });
  }
  if ((lineDiscounted || input.saleDiscount > 0) && !has("sales.apply_discount")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to apply discounts." });
  }

  const subtotal = Number(lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2));
  const discountTotal = Number((lines.reduce((s, l) => s + l.discountAmount, 0) + input.saleDiscount).toFixed(2));
  const grandTotal = Number((subtotal - input.saleDiscount).toFixed(2));
  if (grandTotal <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The sale total must be greater than zero." });
  }
  return { lines, subtotal, discountTotal, grandTotal };
}

/** Customer + wallet validation for CREDIT / DEPOSIT modes. Returns the customer row (null for walk-in PAY_LATER). */
async function validatePaymentMode(db: Db, input: z.infer<typeof saleBodyInput>, grandTotal: number, has: (key: string) => boolean) {
  if (input.paymentMode === "PAY_LATER") {
    if (input.customerId) {
      const [c] = await db.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
      if (!c) throw new TRPCError({ code: "BAD_REQUEST", message: "Customer not found." });
      if (c.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Customer "${c.fullName}" is ${c.status.toLowerCase()}.` });
      return c;
    }
    return null;
  }

  if (!input.customerId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Select a customer — ${input.paymentMode === "CREDIT" ? "credit" : "deposit"} sales need a customer account.` });
  }
  const [customer] = await db.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
  if (!customer) throw new TRPCError({ code: "BAD_REQUEST", message: "Customer not found." });
  if (customer.status !== "ACTIVE") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Customer "${customer.fullName}" is ${customer.status.toLowerCase()}.` });
  }

  if (input.paymentMode === "CREDIT") {
    if (!has("sales.sell_on_credit")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to sell on credit." });
    }
    if (customer.creditLimit <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `"${customer.fullName}" has no credit allowance — use pay-later or deposit.` });
    }
    const headroom = Number((customer.creditLimit - customer.creditOutstanding).toFixed(2));
    if (grandTotal > headroom) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Credit limit exceeded: ${customer.fullName} owes ₦${customer.creditOutstanding.toLocaleString()} of a ₦${customer.creditLimit.toLocaleString()} limit — only ₦${headroom.toLocaleString()} available, this sale is ₦${grandTotal.toLocaleString()}.`,
      });
    }
  } else {
    // DEPOSIT
    if (customer.depositBalance < grandTotal) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Insufficient deposit balance: ${customer.fullName} holds ₦${customer.depositBalance.toLocaleString()} — this sale is ₦${grandTotal.toLocaleString()}.`,
      });
    }
  }
  return customer;
}

/** Soft stock check at submission (the hard guard re-runs inside final approval). */
function assertStockAvailable(
  lines: { productId: number; packsDeducted: number }[],
  productRows: { id: number; name: string; currentStock: number }[],
) {
  const byId = new Map(productRows.map((p) => [p.id, p]));
  for (const line of lines) {
    const p = byId.get(line.productId);
    if (p && p.currentStock < line.packsDeducted) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Not enough stock for "${p.name}" — ${p.currentStock} pack(s) on hand, this sale needs ${line.packsDeducted}.`,
      });
    }
  }
}

function orderNoFor(id: number) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `SO-${ymd}-${String(id).padStart(4, "0")}`;
}

function summaryFor(orderNo: string, customerName: string | null, grandTotal: number, itemCount: number, mode: PaymentMode) {
  const modeLabel = mode === "CREDIT" ? "on credit" : mode === "DEPOSIT" ? "from deposit wallet" : "pay later";
  return `Sale ${orderNo} — ${customerName ?? "Walk-in customer"} — ₦${grandTotal.toLocaleString()} (${itemCount} item${itemCount === 1 ? "" : "s"}, ${modeLabel})`;
}

/**
 * Puts a DRAFT/ON_HOLD sale into the approval chain — or completes it
 * immediately when no SALE flow is configured. Runs in the caller's tx.
 */
async function submitSale(tx: Tx, saleId: number, requesterId: number) {
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));
  let customerName: string | null = null;
  if (sale.customerId) {
    const [c] = await tx.select({ fullName: customers.fullName }).from(customers).where(eq(customers.id, sale.customerId)).limit(1);
    customerName = c?.fullName ?? null;
  }
  const mode = parsePaymentMode(sale.notes);
  const summary = summaryFor(sale.orderNo, customerName, sale.grandTotal, items.length, mode);

  const steps = await getFlowSteps(tx, "SALE");
  if (steps.length === 0) {
    // No chain configured → complete immediately.
    await tx.update(sales).set({ status: "PENDING_APPROVAL", submittedAt: new Date() }).where(eq(sales.id, saleId));
    await finalizeSale(tx, saleId, requesterId);
    return { outcome: "COMPLETED" as const, summary };
  }

  await tx.update(sales).set({ status: "PENDING_APPROVAL", submittedAt: new Date() }).where(eq(sales.id, saleId));
  const requestId = await submitApproval(tx, {
    requestType: "SALE_CREATE",
    entityType: "SALE",
    entityId: saleId,
    payload: {
      orderNo: sale.orderNo,
      customer: customerName,
      paymentMode: mode,
      subtotal: sale.subtotal,
      discountTotal: sale.discountTotal,
      grandTotal: sale.grandTotal,
      notes: sale.notes,
      items: items.map((i) => ({
        product: i.productName,
        sku: i.sku,
        soldAsUnits: i.soldAsUnits,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountAmount: i.discountAmount,
        lineTotal: i.lineTotal,
      })),
    },
    summary,
    requesterId,
    steps,
  });
  return { outcome: "PENDING" as const, summary, requestId };
}

async function loadSaleOrThrow(db: Db | Tx, saleId: number) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  return sale;
}

function assertCanTouch(sale: typeof sales.$inferSelect, userId: number, has: (k: string) => boolean) {
  if (sale.salesRepId !== userId && !has("sales.view_all")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage your own sales." });
  }
}

export const salesRouter = createRouter({
  /* --------------------------------- LIST --------------------------------- */

  list: permissionProcedure("sales.view")
    .input(
      z
        .object({
          status: z.enum(SALE_STATUSES).optional(),
          customerId: z.number().int().positive().optional(),
          search: z.string().trim().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conds = [];
      if (!ctx.permissions.has("sales.view_all")) conds.push(eq(sales.salesRepId, ctx.user.id));
      if (input?.status) conds.push(eq(sales.status, input.status));
      if (input?.customerId) conds.push(eq(sales.customerId, input.customerId));
      if (input?.search) {
        conds.push(or(like(sales.orderNo, `%${input.search}%`), like(sales.notes, `%${input.search}%`))!);
      }
      if (input?.dateFrom) conds.push(gte(sales.createdAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input?.dateTo) conds.push(lte(sales.createdAt, new Date(`${input.dateTo}T23:59:59`)));

      const rows = await db
        .select({ sale: sales, repName: users.fullName, customerName: customers.fullName })
        .from(sales)
        .innerJoin(users, eq(users.id, sales.salesRepId))
        .leftJoin(customers, eq(customers.id, sales.customerId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(sales.createdAt))
        .limit(300);
      return rows.map((r) => ({
        ...r.sale,
        repName: r.repName,
        customerName: r.customerName,
        paymentMode: parsePaymentMode(r.sale.notes),
      }));
    }),

  /* -------------------------------- DETAILS -------------------------------- */

  getById: permissionProcedure("sales.view_details")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const sale = await loadSaleOrThrow(db, input.id);
      assertCanTouch(sale, ctx.user.id, (k) => ctx.permissions.has(k));

      const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
      const [rep] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, sale.salesRepId)).limit(1);
      const customer = sale.customerId
        ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
        : null;
      const approver = sale.finalApprovedBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, sale.finalApprovedBy)).limit(1))[0]
        : null;
      const canceller = sale.cancelledBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, sale.cancelledBy)).limit(1))[0]
        : null;
      const [request] = await db
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.entityType, "SALE"), eq(approvalRequests.entityId, sale.id)))
        .orderBy(desc(approvalRequests.createdAt))
        .limit(1);

      return {
        sale: { ...sale, paymentMode: parsePaymentMode(sale.notes) },
        items,
        repName: rep?.fullName ?? null,
        customer,
        approverName: approver?.fullName ?? null,
        cancellerName: canceller?.fullName ?? null,
        approvalRequest: request ?? null,
        canManage: sale.salesRepId === ctx.user.id,
        canCancel: ctx.permissions.has("sales.cancel"),
      };
    }),

  /* --------------------------------- CREATE -------------------------------- */

  create: permissionProcedure("sales.create")
    .input(saleBodyInput.extend({ action: z.enum(["DRAFT", "SUBMIT", "HOLD"]).default("SUBMIT") }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const has = (k: string) => ctx.permissions.has(k);
      if (input.action === "HOLD" && !has("sales.hold")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to hold sales." });
      }
      const { lines, subtotal, discountTotal, grandTotal } = await prepareSaleLines(db, input, has);
      const customer = await validatePaymentMode(db, input, grandTotal, has);
      const productRows = await db
        .select({ id: products.id, name: products.name, currentStock: products.currentStock })
        .from(products)
        .where(inArray(products.id, lines.map((l) => l.productId)));
      if (input.action === "SUBMIT") assertStockAvailable(lines, productRows);

      const stampedNotes = `[mode:${input.paymentMode}]${input.notes ? ` ${input.notes}` : ""}`;
      const result = await db.transaction(async (tx) => {
        const [{ id: saleId }] = await tx
          .insert(sales)
          .values({
            orderNo: "PENDING", // replaced with the real id below
            salesRepId: ctx.user.id,
            customerId: customer?.id ?? null,
            status: input.action === "HOLD" ? "ON_HOLD" : "DRAFT",
            itemCount: lines.length,
            subtotal,
            discountTotal,
            discountNote: input.discountNote || null,
            grandTotal,
            balanceDue: grandTotal,
            notes: stampedNotes,
            heldAt: input.action === "HOLD" ? new Date() : null,
          })
          .$returningId();
        const orderNo = orderNoFor(saleId);
        await tx.update(sales).set({ orderNo }).where(eq(sales.id, saleId));
        await tx.insert(saleItems).values(lines.map((l) => ({ ...l, saleId })));

        if (input.action === "SUBMIT") {
          const sub = await submitSale(tx, saleId, ctx.user.id);
          return { saleId, orderNo, ...sub };
        }
        return { saleId, orderNo, outcome: input.action === "HOLD" ? ("HELD" as const) : ("DRAFT" as const), summary: summaryFor(orderNo, customer?.fullName ?? null, grandTotal, lines.length, input.paymentMode) };
      });

      await logAudit({
        actorId: ctx.user.id,
        action:
          result.outcome === "COMPLETED"
            ? "sale.completed"
            : result.outcome === "PENDING"
              ? "sale.submitted"
              : result.outcome === "HELD"
                ? "sale.held"
                : "sale.created",
        entityType: "SALE",
        entityId: result.saleId,
        description:
          result.outcome === "PENDING"
            ? `Submitted for approval: ${result.summary}`
            : result.outcome === "COMPLETED"
              ? `Sale completed (no approval chain): ${result.summary}`
              : result.outcome === "HELD"
                ? `Sale put on hold: ${result.summary}`
                : `Draft sale saved: ${result.summary}`,
        afterData: { orderNo: result.orderNo, grandTotal, paymentMode: input.paymentMode, items: lines.length },
        ...requestMeta(ctx.req),
      });
      return result;
    }),

  /** Replace the contents of a DRAFT/ON_HOLD sale (POS "edit before submit"). */
  updateDraft: permissionProcedure("sales.create")
    .input(saleBodyInput.extend({ saleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const has = (k: string) => ctx.permissions.has(k);
      const sale = await loadSaleOrThrow(db, input.saleId);
      assertCanTouch(sale, ctx.user.id, has);
      if (sale.status !== "DRAFT" && sale.status !== "ON_HOLD") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft or held sales can be edited." });
      }
      const { lines, subtotal, discountTotal, grandTotal } = await prepareSaleLines(db, input, has);
      const customer = await validatePaymentMode(db, input, grandTotal, has);
      const before = {
        grandTotal: sale.grandTotal,
        itemCount: sale.itemCount,
        paymentMode: parsePaymentMode(sale.notes),
      };
      const stampedNotes = `[mode:${input.paymentMode}]${input.notes ? ` ${input.notes}` : ""}`;
      await db.transaction(async (tx) => {
        await tx.delete(saleItems).where(eq(saleItems.saleId, sale.id));
        await tx.insert(saleItems).values(lines.map((l) => ({ ...l, saleId: sale.id })));
        await tx
          .update(sales)
          .set({
            customerId: customer?.id ?? null,
            itemCount: lines.length,
            subtotal,
            discountTotal,
            discountNote: input.discountNote || null,
            grandTotal,
            balanceDue: grandTotal,
            notes: stampedNotes,
          })
          .where(eq(sales.id, sale.id));
      });
      await logAudit({
        actorId: ctx.user.id,
        action: "sale.updated",
        entityType: "SALE",
        entityId: sale.id,
        description: `Edited draft sale ${sale.orderNo} — now ${summaryFor(sale.orderNo, customer?.fullName ?? null, grandTotal, lines.length, input.paymentMode)}`,
        beforeData: before,
        afterData: { grandTotal, itemCount: lines.length, paymentMode: input.paymentMode },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, orderNo: sale.orderNo };
    }),

  /* ------------------------------ SUBMIT / HOLD ----------------------------- */

  submit: permissionProcedure("sales.create")
    .input(z.object({ saleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const sale = await loadSaleOrThrow(db, input.saleId);
      assertCanTouch(sale, ctx.user.id, (k) => ctx.permissions.has(k));
      if (sale.status !== "DRAFT" && sale.status !== "ON_HOLD") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This sale has already been submitted." });
      }
      // Re-validate wallets & stock at submission time — balances may have moved.
      const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
      const mode = parsePaymentMode(sale.notes);
      await validatePaymentMode(
        db,
        { customerId: sale.customerId ?? undefined, paymentMode: mode, items: [], saleDiscount: 0 },
        sale.grandTotal,
        (k) => ctx.permissions.has(k),
      );
      const productRows = await db
        .select({ id: products.id, name: products.name, currentStock: products.currentStock })
        .from(products)
        .where(inArray(products.id, items.map((i) => i.productId)));
      assertStockAvailable(
        items.map((i) => ({ packsDeducted: i.packsDeducted, productId: i.productId })),
        productRows,
      );

      const result = await db.transaction(async (tx) => submitSale(tx, sale.id, ctx.user.id));
      await logAudit({
        actorId: ctx.user.id,
        action: result.outcome === "COMPLETED" ? "sale.completed" : "sale.submitted",
        entityType: "SALE",
        entityId: sale.id,
        description: result.outcome === "COMPLETED" ? `Sale completed (no approval chain): ${result.summary}` : `Submitted for approval: ${result.summary}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, ...result };
    }),

  hold: permissionProcedure("sales.hold")
    .input(z.object({ saleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const sale = await loadSaleOrThrow(db, input.saleId);
      assertCanTouch(sale, ctx.user.id, (k) => ctx.permissions.has(k));
      if (sale.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a draft sale can be put on hold." });
      }
      await db.update(sales).set({ status: "ON_HOLD", heldAt: new Date() }).where(eq(sales.id, sale.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "sale.held",
        entityType: "SALE",
        entityId: sale.id,
        description: `Sale ${sale.orderNo} put on hold.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),

  resume: permissionProcedure("sales.hold")
    .input(z.object({ saleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const sale = await loadSaleOrThrow(db, input.saleId);
      assertCanTouch(sale, ctx.user.id, (k) => ctx.permissions.has(k));
      if (sale.status !== "ON_HOLD") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This sale is not on hold." });
      }
      await db.update(sales).set({ status: "DRAFT", heldAt: null }).where(eq(sales.id, sale.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "sale.resumed",
        entityType: "SALE",
        entityId: sale.id,
        description: `Sale ${sale.orderNo} resumed from hold.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),

  /* --------------------------------- CANCEL -------------------------------- */

  cancel: permissionProcedure("sales.view")
    .input(z.object({ saleId: z.number().int().positive(), reason: z.string().trim().min(3, "Give a reason for cancelling.").max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const has = (k: string) => ctx.permissions.has(k);
      const sale = await loadSaleOrThrow(db, input.saleId);
      const own = sale.salesRepId === ctx.user.id;
      if (!own && !has("sales.cancel")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to cancel this sale." });
      }
      if (sale.status === "CANCELLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This sale is already cancelled." });
      }
      if (sale.status === "COMPLETED" && !has("sales.cancel")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cancelling a completed sale requires the cancel-sales permission." });
      }
      if (sale.status === "COMPLETED" && sale.amountPaid > 0 && !sale.usedDeposit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payments have already been confirmed against this sale — reverse them in the payments module first.",
        });
      }

      await db.transaction(async (tx) => {
        if (sale.status === "COMPLETED") {
          // Restore stock, reverse wallets, roll back lifetime stats.
          const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
          for (const item of items) {
            await applyMovement(tx, {
              productId: item.productId,
              movementType: "RETURN_IN",
              quantity: item.packsDeducted,
              referenceType: "SALE",
              referenceId: sale.id,
              reason: `Sale ${sale.orderNo} cancelled — stock restored`,
              performedBy: ctx.user.id,
            });
          }
          const mode = parsePaymentMode(sale.notes);
          if (sale.customerId) {
            if (mode === "CREDIT" && sale.grandTotal > 0) {
              await applyCustomerTx(tx, {
                customerId: sale.customerId,
                transactionType: "ADJUSTMENT",
                creditDelta: -sale.grandTotal,
                referenceType: "SALE",
                referenceId: sale.id,
                notes: `Sale ${sale.orderNo} cancelled — credit reversed`,
                performedBy: ctx.user.id,
              });
            } else if (mode === "DEPOSIT" && sale.grandTotal > 0) {
              await applyCustomerTx(tx, {
                customerId: sale.customerId,
                transactionType: "DEPOSIT_IN",
                depositDelta: sale.grandTotal,
                referenceType: "SALE",
                referenceId: sale.id,
                notes: `Sale ${sale.orderNo} cancelled — deposit returned to wallet`,
                performedBy: ctx.user.id,
              });
            }
            await bumpCustomerStats(tx, sale.customerId, -sale.grandTotal);
          }
        }
        if (sale.status === "PENDING_APPROVAL") {
          // Kill the open approval request with the sale.
          const [request] = await tx
            .select()
            .from(approvalRequests)
            .where(and(eq(approvalRequests.entityType, "SALE"), eq(approvalRequests.entityId, sale.id), eq(approvalRequests.status, "PENDING")))
            .limit(1);
          if (request) {
            await tx
              .update(approvalRequestSteps)
              .set({ status: "SKIPPED", actedAt: new Date() })
              .where(and(eq(approvalRequestSteps.requestId, request.id), eq(approvalRequestSteps.status, "PENDING")));
            await tx
              .update(approvalRequests)
              .set({ status: "CANCELLED", resolvedAt: new Date() })
              .where(eq(approvalRequests.id, request.id));
          }
        }
        await tx
          .update(sales)
          .set({ status: "CANCELLED", cancelledBy: ctx.user.id, cancelReason: input.reason, cancelledAt: new Date() })
          .where(eq(sales.id, sale.id));
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "sale.cancelled",
        entityType: "SALE",
        entityId: sale.id,
        description: `Cancelled sale ${sale.orderNo} (was ${sale.status}) — ${input.reason}`,
        beforeData: { status: sale.status, grandTotal: sale.grandTotal },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const };
    }),
});
