import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  customers,
  products,
  sales,
  salesExchangeItems,
  salesExchanges,
  users,
} from "@db/schema";
import { EXCHANGE_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { getFlowSteps, submitApproval } from "../services/approvals.service";
import { applyExchangeEffects, getReturnableQuantities } from "../services/returns.service";

/**
 * YABUZ OIL & GAS — sales exchanges router
 * Swap items from a completed sale for different items. Returned items go
 * back into stock at their original sold value; new items leave stock at
 * their current selling price.
 *
 * difference = newTotal − returnedTotal
 *   > 0 → customer tops up: CASH / BANK_TRANSFER / POS / CHEQUE /
 *         DEPOSIT wallet draw / added to outstanding CREDIT
 *   < 0 → difference credited to the customer's advance deposit wallet
 *         (from there it can be refunded via the normal refund flow)
 *   = 0 → straight swap
 */

const SETTLEMENT_METHODS = [
  "NONE",
  "TOPUP_CASH",
  "TOPUP_TRANSFER",
  "TOPUP_POS",
  "TOPUP_CHEQUE",
  "TOPUP_DEPOSIT",
  "TOPUP_CREDIT",
  "TO_DEPOSIT",
] as const;

export const exchangesRouter = createRouter({
  list: permissionProcedure("exchanges.view")
    .input(
      z
        .object({
          status: z.enum(EXCHANGE_STATUSES).optional(),
          customerId: z.number().int().positive().optional(),
          search: z.string().trim().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.status) conds.push(eq(salesExchanges.status, input.status));
      if (input?.customerId) conds.push(eq(salesExchanges.customerId, input.customerId));
      if (input?.search) {
        conds.push(or(like(salesExchanges.reference, `%${input.search}%`), like(salesExchanges.reason, `%${input.search}%`))!);
      }
      if (input?.dateFrom) conds.push(gte(salesExchanges.createdAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input?.dateTo) conds.push(lte(salesExchanges.createdAt, new Date(`${input.dateTo}T23:59:59`)));
      const rows = await db
        .select({
          ex: salesExchanges,
          orderNo: sales.orderNo,
          customerName: customers.fullName,
          processorName: users.fullName,
        })
        .from(salesExchanges)
        .innerJoin(sales, eq(sales.id, salesExchanges.saleId))
        .leftJoin(customers, eq(customers.id, salesExchanges.customerId))
        .innerJoin(users, eq(users.id, salesExchanges.processedBy))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(salesExchanges.createdAt))
        .limit(300);
      return rows.map((r) => ({
        ...r.ex,
        orderNo: r.orderNo,
        customerName: r.customerName,
        processorName: r.processorName,
      }));
    }),

  getById: permissionProcedure("exchanges.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [ex] = await db.select().from(salesExchanges).where(eq(salesExchanges.id, input.id)).limit(1);
      if (!ex) throw new TRPCError({ code: "NOT_FOUND", message: "Exchange not found." });
      const items = await db.select().from(salesExchangeItems).where(eq(salesExchangeItems.exchangeId, ex.id));
      const [sale] = await db.select({ orderNo: sales.orderNo }).from(sales).where(eq(sales.id, ex.saleId)).limit(1);
      const customer = ex.customerId
        ? (await db.select().from(customers).where(eq(customers.id, ex.customerId)).limit(1))[0]
        : null;
      const [processor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ex.processedBy)).limit(1);
      const approver = ex.approvedBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ex.approvedBy)).limit(1))[0]
        : null;
      return {
        ex,
        returnedItems: items.filter((i) => i.direction === "RETURNED"),
        newItems: items.filter((i) => i.direction === "NEW"),
        orderNo: sale?.orderNo ?? null,
        customer,
        processorName: processor?.fullName ?? null,
        approverName: approver?.fullName ?? null,
      };
    }),

  /** Sale lines still exchangeable + live product list for picking new items. */
  saleItems: permissionProcedure("exchanges.create")
    .input(z.object({ saleId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [sale] = await db.select().from(sales).where(eq(sales.id, input.saleId)).limit(1);
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
      if (sale.status !== "COMPLETED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is ${sale.status.toLowerCase()} — exchanges are only possible on completed sales.` });
      }
      const lines = await getReturnableQuantities(db, sale.id);
      const customer = sale.customerId
        ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
        : null;
      const catalog = await db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          packDescription: products.packDescription,
          sellCartonPrice: products.sellCartonPrice,
          sellUnitPrice: products.sellUnitPrice,
          allowUnitSales: products.allowUnitSales,
          unitsPerPack: products.unitsPerPack,
          currentStock: products.currentStock,
          unitLabel: products.unitLabel,
        })
        .from(products)
        .where(eq(products.status, "ACTIVE"))
        .orderBy(products.name);
      return { sale, lines, customer, catalog };
    }),

  create: permissionProcedure("exchanges.create")
    .input(
      z.object({
        saleId: z.number().int().positive(),
        returnedItems: z
          .array(
            z.object({
              saleItemId: z.number().int().positive(),
              quantity: z.number().positive("Quantity must be greater than zero"),
            }),
          )
          .min(1, "Select at least one item to return."),
        newItems: z
          .array(
            z.object({
              productId: z.number().int().positive(),
              soldAsUnits: z.boolean().default(false),
              quantity: z.number().positive("Quantity must be greater than zero"),
            }),
          )
          .min(1, "Add at least one new item."),
        settlementType: z.enum(SETTLEMENT_METHODS),
        externalReference: z.string().trim().max(120).optional(),
        proofUrl: z.string().url().max(500).optional(),
        proofPublicId: z.string().max(255).optional(),
        reason: z.string().trim().min(3, "Give a reason for the exchange.").max(500),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [sale] = await db.select().from(sales).where(eq(sales.id, input.saleId)).limit(1);
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
      if (sale.status !== "COMPLETED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is ${sale.status.toLowerCase()} — exchanges are only possible on completed sales.` });
      }

      /* ----- Returned side ----- */
      const returnable = await getReturnableQuantities(db, sale.id);
      const byId = new Map(returnable.map((l) => [l.id, l]));
      const returnedLines = input.returnedItems.map((sel, idx) => {
        const line = byId.get(sel.saleItemId);
        if (!line) throw new TRPCError({ code: "BAD_REQUEST", message: `Returned line ${idx + 1}: sale item not found.` });
        if (sel.quantity > line.returnableQty) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${line.productName}": only ${line.returnableQty} can still be taken back.`,
          });
        }
        return {
          direction: "RETURNED" as const,
          saleItemId: line.id,
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          soldAsUnits: line.soldAsUnits,
          quantity: sel.quantity,
          packsQty: line.soldAsUnits
            ? Number((sel.quantity * (line.packsDeducted / line.quantity)).toFixed(3))
            : Number(sel.quantity.toFixed(3)),
          unitPrice: line.unitPrice,
          lineTotal: Number((sel.quantity * line.unitPrice).toFixed(2)),
        };
      });
      const returnedTotal = Number(returnedLines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2));

      /* ----- New side (current prices, live stock check) ----- */
      const productRows = await db
        .select()
        .from(products)
        .where(inArray(products.id, [...new Set(input.newItems.map((i) => i.productId))]));
      const byProduct = new Map(productRows.map((p) => [p.id, p]));
      const newLines = input.newItems.map((sel, idx) => {
        const p = byProduct.get(sel.productId);
        if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: `New line ${idx + 1}: product not found.` });
        if (sel.soldAsUnits && !p.allowUnitSales) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `"${p.name}" is sold in whole packs only.` });
        }
        const packsQty = sel.soldAsUnits
          ? Number((sel.quantity / p.unitsPerPack).toFixed(3))
          : Number(sel.quantity.toFixed(3));
        if (p.currentStock < packsQty) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Not enough stock for "${p.name}" — ${p.currentStock} pack(s) on hand.` });
        }
        const unitPrice = sel.soldAsUnits ? p.sellUnitPrice : p.sellCartonPrice;
        return {
          direction: "NEW" as const,
          saleItemId: null,
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          soldAsUnits: sel.soldAsUnits,
          quantity: sel.quantity,
          packsQty,
          unitPrice,
          lineTotal: Number((sel.quantity * unitPrice).toFixed(2)),
        };
      });
      const newTotal = Number(newLines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2));
      const difference = Number((newTotal - returnedTotal).toFixed(2));

      /* ----- Settlement validation ----- */
      if (difference > 0) {
        if (input.settlementType === "NONE" || input.settlementType === "TO_DEPOSIT") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `The new items cost ₦${difference.toLocaleString()} more — choose how the customer tops up (cash, transfer, POS, cheque, deposit wallet or credit).` });
        }
      } else if (difference < 0) {
        if (input.settlementType !== "TO_DEPOSIT") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `The new items cost ₦${(-difference).toLocaleString()} less — the difference must go to the customer's deposit wallet (settlement: TO_DEPOSIT).` });
        }
        if (!sale.customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This sale has no customer account — the exchange difference can't be credited anywhere." });
        }
      } else if (input.settlementType !== "NONE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The values match exactly — settlement should be NONE (straight swap)." });
      }

      if (difference > 0 && (input.settlementType === "TOPUP_DEPOSIT" || input.settlementType === "TOPUP_CREDIT") && !sale.customerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This sale has no customer account — collect the top-up by cash, transfer or POS instead." });
      }
      if (input.settlementType === "TOPUP_DEPOSIT" && sale.customerId) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
        if (!cust || cust.depositBalance < difference) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient deposit balance for the ₦${difference.toLocaleString()} top-up (wallet holds ₦${cust?.depositBalance.toLocaleString() ?? 0}).` });
        }
      }
      if (input.settlementType === "TOPUP_CREDIT" && sale.customerId) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
        if (cust && cust.creditLimit > 0) {
          const headroom = Number((cust.creditLimit - cust.creditOutstanding).toFixed(2));
          if (difference > headroom) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Credit limit exceeded — ${cust.fullName} has ₦${headroom.toLocaleString()} headroom, this top-up is ₦${difference.toLocaleString()}.` });
          }
        }
      }

      const [customer] = sale.customerId
        ? await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1)
        : [null];

      const result = await db.transaction(async (tx) => {
        const [{ id: exchangeId }] = await tx
          .insert(salesExchanges)
          .values({
            reference: "PENDING",
            saleId: sale.id,
            customerId: sale.customerId,
            status: "PENDING_APPROVAL",
            returnedTotal,
            newTotal,
            difference,
            settlementType: input.settlementType,
            settledAmount: 0,
            externalReference: input.externalReference || null,
            proofUrl: input.proofUrl ?? null,
            proofPublicId: input.proofPublicId ?? null,
            reason: input.reason,
            notes: input.notes || null,
            processedBy: ctx.user.id,
          })
          .$returningId();
        const reference = `EXC-${String(exchangeId).padStart(6, "0")}`;
        await tx.update(salesExchanges).set({ reference }).where(eq(salesExchanges.id, exchangeId));
        await tx.insert(salesExchangeItems).values(returnedLines.map((l) => ({ ...l, exchangeId })));
        await tx.insert(salesExchangeItems).values(newLines.map((l) => ({ ...l, exchangeId })));

        const settlementLabel =
          difference === 0
            ? "straight swap"
            : difference > 0
              ? `top-up ₦${difference.toLocaleString()} via ${input.settlementType.replace("TOPUP_", "").toLowerCase()}`
              : `₦${(-difference).toLocaleString()} → deposit wallet`;
        const summary = `Exchange ${reference} — ${sale.orderNo} — ${customer?.fullName ?? "Walk-in customer"} — returned ₦${returnedTotal.toLocaleString()} ↔ new ₦${newTotal.toLocaleString()} (${settlementLabel})`;

        const steps = await getFlowSteps(tx, "SALE_EXCHANGE");
        if (steps.length === 0) {
          await applyExchangeEffects(tx, exchangeId, ctx.user.id);
          return { exchangeId, reference, outcome: "COMPLETED" as const, summary };
        }
        const requestId = await submitApproval(tx, {
          requestType: "SALE_EXCHANGE_CREATE",
          entityType: "SALE_EXCHANGE",
          entityId: exchangeId,
          payload: {
            reference,
            orderNo: sale.orderNo,
            customer: customer?.fullName ?? null,
            reason: input.reason,
            returnedTotal,
            newTotal,
            difference,
            settlement: settlementLabel,
            returnedItems: returnedLines.map((l) => ({ product: l.productName, quantity: l.quantity, lineTotal: l.lineTotal })),
            newItems: newLines.map((l) => ({ product: l.productName, quantity: l.quantity, lineTotal: l.lineTotal })),
          },
          summary,
          requesterId: ctx.user.id,
          steps,
        });
        return { exchangeId, reference, outcome: "PENDING" as const, summary, requestId };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: result.outcome === "COMPLETED" ? "exchange.completed" : "exchange.submitted",
        entityType: "SALE_EXCHANGE",
        entityId: result.exchangeId,
        description: result.outcome === "COMPLETED" ? `Exchange completed (no approval chain): ${result.summary}` : `Exchange submitted for approval: ${result.summary}`,
        afterData: { reference: result.reference, saleId: sale.id, returnedTotal, newTotal, difference, settlementType: input.settlementType },
        ...requestMeta(ctx.req),
      });
      return result;
    }),
});
