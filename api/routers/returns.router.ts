import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, like, lte, or } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  customers,
  sales,
  salesReturnItems,
  salesReturns,
  users,
} from "@db/schema";
import { RETURN_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { getFlowSteps, submitApproval } from "../services/approvals.service";
import { applyReturnEffects, getReturnableQuantities } from "../services/returns.service";

/**
 * YABUZ OIL & GAS — sales returns router
 * A customer returns some items — or every item — of a completed sale.
 * On approval the stock is restored and the value goes into the
 * customer's advance deposit wallet (outstanding credit is cleared
 * first). Refunds from the deposit wallet then use the normal
 * deposit-refund payment flow.
 */

type Db = ReturnType<typeof getDb>;

async function loadCompletedSale(db: Db, saleId: number) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  if (sale.status !== "COMPLETED") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Sale ${sale.orderNo} is ${sale.status.toLowerCase()} — returns are only possible on completed sales.` });
  }
  return sale;
}

export const returnsRouter = createRouter({
  list: permissionProcedure("returns.view")
    .input(
      z
        .object({
          status: z.enum(RETURN_STATUSES).optional(),
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
      if (input?.status) conds.push(eq(salesReturns.status, input.status));
      if (input?.customerId) conds.push(eq(salesReturns.customerId, input.customerId));
      if (input?.search) {
        conds.push(or(like(salesReturns.reference, `%${input.search}%`), like(salesReturns.reason, `%${input.search}%`))!);
      }
      if (input?.dateFrom) conds.push(gte(salesReturns.createdAt, new Date(`${input.dateFrom}T00:00:00`)));
      if (input?.dateTo) conds.push(lte(salesReturns.createdAt, new Date(`${input.dateTo}T23:59:59`)));
      const rows = await db
        .select({
          ret: salesReturns,
          orderNo: sales.orderNo,
          customerName: customers.fullName,
          processorName: users.fullName,
        })
        .from(salesReturns)
        .innerJoin(sales, eq(sales.id, salesReturns.saleId))
        .leftJoin(customers, eq(customers.id, salesReturns.customerId))
        .innerJoin(users, eq(users.id, salesReturns.processedBy))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(salesReturns.createdAt))
        .limit(300);
      return rows.map((r) => ({
        ...r.ret,
        orderNo: r.orderNo,
        customerName: r.customerName,
        processorName: r.processorName,
      }));
    }),

  getById: permissionProcedure("returns.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [ret] = await db.select().from(salesReturns).where(eq(salesReturns.id, input.id)).limit(1);
      if (!ret) throw new TRPCError({ code: "NOT_FOUND", message: "Return not found." });
      const items = await db.select().from(salesReturnItems).where(eq(salesReturnItems.returnId, ret.id));
      const [sale] = await db.select({ orderNo: sales.orderNo }).from(sales).where(eq(sales.id, ret.saleId)).limit(1);
      const customer = ret.customerId
        ? (await db.select().from(customers).where(eq(customers.id, ret.customerId)).limit(1))[0]
        : null;
      const [processor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ret.processedBy)).limit(1);
      const approver = ret.approvedBy
        ? (await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ret.approvedBy)).limit(1))[0]
        : null;
      return {
        ret,
        items,
        orderNo: sale?.orderNo ?? null,
        customer,
        processorName: processor?.fullName ?? null,
        approverName: approver?.fullName ?? null,
      };
    }),

  /** Sale lines with how much of each is still returnable (for the return form). */
  saleItems: permissionProcedure("returns.create")
    .input(z.object({ saleId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const sale = await loadCompletedSale(db, input.saleId);
      const lines = await getReturnableQuantities(db, sale.id);
      const customer = sale.customerId
        ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
        : null;
      return { sale, lines, customer };
    }),

  create: permissionProcedure("returns.create")
    .input(
      z.object({
        saleId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              saleItemId: z.number().int().positive(),
              quantity: z.number().positive("Quantity must be greater than zero"),
            }),
          )
          .min(1, "Select at least one item to return."),
        restock: z.boolean().default(true),
        reason: z.string().trim().min(3, "Give a reason for the return.").max(500),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const sale = await loadCompletedSale(db, input.saleId);
      if (!sale.customerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This sale has no customer account — returns need a customer so the value can go into their deposit wallet." });
      }
      const returnable = await getReturnableQuantities(db, sale.id);
      const byId = new Map(returnable.map((l) => [l.id, l]));

      // Build the return lines (validated against what's still returnable).
      const lines = input.items.map((sel, idx) => {
        const line = byId.get(sel.saleItemId);
        if (!line) throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${idx + 1}: sale item not found.` });
        if (sel.quantity > line.returnableQty) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${line.productName}": only ${line.returnableQty} can still be returned (sold ${line.quantity}, already returned ${line.alreadyReturned}).`,
          });
        }
        const lineTotal = Number((sel.quantity * line.unitPrice).toFixed(2));
        const packsRestored = line.soldAsUnits
          ? Number((sel.quantity * (line.packsDeducted / line.quantity)).toFixed(3))
          : Number(sel.quantity.toFixed(3));
        return {
          saleItemId: line.id,
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          soldAsUnits: line.soldAsUnits,
          quantity: sel.quantity,
          packsRestored,
          unitPrice: line.unitPrice,
          lineTotal,
        };
      });
      const totalAmount = Number(lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2));
      if (totalAmount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The return total must be greater than zero." });
      }

      const [customer] = await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
      const wholeSale = returnable.every((l) => {
        const sel = input.items.find((i) => i.saleItemId === l.id);
        return l.returnableQty === 0 || (sel && sel.quantity >= l.returnableQty);
      });

      const result = await db.transaction(async (tx) => {
        const [{ id: returnId }] = await tx
          .insert(salesReturns)
          .values({
            reference: "PENDING",
            saleId: sale.id,
            customerId: sale.customerId,
            status: "PENDING_APPROVAL",
            totalAmount,
            restock: input.restock,
            reason: input.reason,
            notes: input.notes || null,
            processedBy: ctx.user.id,
          })
          .$returningId();
        const reference = `RTN-${String(returnId).padStart(6, "0")}`;
        await tx.update(salesReturns).set({ reference }).where(eq(salesReturns.id, returnId));
        await tx.insert(salesReturnItems).values(lines.map((l) => ({ ...l, returnId })));

        const summary = `Return ${reference} — ${wholeSale ? "FULL sale" : "partial"} from ${sale.orderNo} — ${customer?.fullName ?? "customer"} — ₦${totalAmount.toLocaleString()} → deposit wallet`;
        const steps = await getFlowSteps(tx, "SALE_RETURN");
        if (steps.length === 0) {
          await applyReturnEffects(tx, returnId, ctx.user.id);
          return { returnId, reference, outcome: "COMPLETED" as const, summary };
        }
        const requestId = await submitApproval(tx, {
          requestType: "SALE_RETURN_CREATE",
          entityType: "SALE_RETURN",
          entityId: returnId,
          payload: {
            reference,
            orderNo: sale.orderNo,
            customer: customer?.fullName ?? null,
            restock: input.restock,
            reason: input.reason,
            totalAmount,
            items: lines.map((l) => ({
              product: l.productName,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
            })),
          },
          summary,
          requesterId: ctx.user.id,
          steps,
        });
        return { returnId, reference, outcome: "PENDING" as const, summary, requestId };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: result.outcome === "COMPLETED" ? "return.completed" : "return.submitted",
        entityType: "SALE_RETURN",
        entityId: result.returnId,
        description: result.outcome === "COMPLETED" ? `Return completed (no approval chain): ${result.summary}` : `Return submitted for approval: ${result.summary}`,
        afterData: { reference: result.reference, saleId: sale.id, totalAmount, restock: input.restock, items: lines.length },
        ...requestMeta(ctx.req),
      });
      return result;
    }),
});
