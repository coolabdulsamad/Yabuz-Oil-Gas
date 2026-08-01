import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, count, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { anyPermissionProcedure, permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { customers, customerTransactions, users } from "@db/schema";
import { CUSTOMER_STATUSES, CUSTOMER_TRANSACTION_TYPES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { applyCustomerTx } from "../services/customers.service";

/**
 * YABUZ OIL & GAS — customers, credit & advance deposits router
 * Customer profiles with two wallets each:
 *   creditOutstanding — what the customer owes Yabuz (credit sales)
 *   depositBalance    — money the customer holds with Yabuz in advance
 * Both balances move ONLY through the customer_transactions ledger.
 */

const customerInput = z.object({
  fullName: z.string().min(2, "Customer name is required").max(160),
  businessName: z.string().max(160).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().email("Invalid email").max(160).optional().or(z.literal("")),
  address: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  creditLimit: z.number().min(0),
});

const LEDGER_READ_KEYS = ["customers.view", "credit.view", "deposits.view"];

export const customersRouter = createRouter({
  /* -------------------------------- DIRECTORY -------------------------------- */

  list: permissionProcedure("customers.view")
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(CUSTOMER_STATUSES).optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.status) conds.push(eq(customers.status, input.status));
      if (input.search) {
        const q = `%${input.search}%`;
        conds.push(
          or(
            like(customers.fullName, q),
            like(customers.businessName, q),
            like(customers.phone, q),
            like(customers.code, q),
          ),
        );
      }
      return db
        .select()
        .from(customers)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(customers.fullName));
    }),

  getById: permissionProcedure("customers.view")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const found = await db
        .select({
          id: customers.id,
          code: customers.code,
          fullName: customers.fullName,
          businessName: customers.businessName,
          phone: customers.phone,
          email: customers.email,
          address: customers.address,
          notes: customers.notes,
          creditLimit: customers.creditLimit,
          creditOutstanding: customers.creditOutstanding,
          depositBalance: customers.depositBalance,
          totalSpent: customers.totalSpent,
          lastSaleAt: customers.lastSaleAt,
          status: customers.status,
          createdAt: customers.createdAt,
          createdByName: users.fullName,
        })
        .from(customers)
        .leftJoin(users, eq(customers.createdBy, users.id))
        .where(eq(customers.id, input.id))
        .limit(1);
      const customer = found[0];
      if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
      return customer;
    }),

  create: permissionProcedure("customers.manage")
    .input(customerInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Credit limit changes are gated behind credit.manage.
      if (input.creditLimit > 0 && !ctx.permissions.has("credit.manage")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to set a credit limit (credit.manage).",
        });
      }

      const [{ id }] = await db
        .insert(customers)
        .values({
          code: "TMP",
          fullName: input.fullName.trim(),
          businessName: input.businessName || null,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          notes: input.notes || null,
          creditLimit: input.creditLimit,
          createdBy: ctx.user.id,
        })
        .$returningId();
      const code = `CUST-${String(id).padStart(4, "0")}`;
      await db.update(customers).set({ code }).where(eq(customers.id, id));

      await logAudit({
        actorId: ctx.user.id,
        action: "customer.create",
        entityType: "CUSTOMER",
        entityId: id,
        description: `Created customer "${input.fullName.trim()}" (${code}).`,
        afterData: { ...input, code },
        ...requestMeta(ctx.req),
      });
      return { ok: true, id, code };
    }),

  update: permissionProcedure("customers.manage")
    .input(z.object({ id: z.number(), data: customerInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(customers).where(eq(customers.id, input.id)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });

      if (input.data.creditLimit !== existing.creditLimit && !ctx.permissions.has("credit.manage")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to change credit limits (credit.manage).",
        });
      }

      await db
        .update(customers)
        .set({
          fullName: input.data.fullName.trim(),
          businessName: input.data.businessName || null,
          phone: input.data.phone || null,
          email: input.data.email || null,
          address: input.data.address || null,
          notes: input.data.notes || null,
          creditLimit: input.data.creditLimit,
        })
        .where(eq(customers.id, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "customer.update",
        entityType: "CUSTOMER",
        entityId: input.id,
        description: `Updated customer "${input.data.fullName.trim()}".`,
        beforeData: existing as unknown as Record<string, unknown>,
        afterData: input.data,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  setStatus: permissionProcedure("customers.manage")
    .input(z.object({ id: z.number(), status: z.enum(CUSTOMER_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(customers).where(eq(customers.id, input.id)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
      await db.update(customers).set({ status: input.status }).where(eq(customers.id, input.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "customer.status",
        entityType: "CUSTOMER",
        entityId: input.id,
        description: `Set customer "${existing.fullName}" to ${input.status}.`,
        beforeData: { status: existing.status },
        afterData: { status: input.status },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /* --------------------------------- LEDGER --------------------------------- */

  ledger: anyPermissionProcedure(LEDGER_READ_KEYS)
    .input(
      z.object({
        customerId: z.number(),
        transactionType: z.enum(CUSTOMER_TRANSACTION_TYPES).optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(customerTransactions.customerId, input.customerId)];
      if (input.transactionType) conds.push(eq(customerTransactions.transactionType, input.transactionType));
      return db
        .select({
          id: customerTransactions.id,
          transactionType: customerTransactions.transactionType,
          creditDelta: customerTransactions.creditDelta,
          depositDelta: customerTransactions.depositDelta,
          creditBalanceAfter: customerTransactions.creditBalanceAfter,
          depositBalanceAfter: customerTransactions.depositBalanceAfter,
          referenceType: customerTransactions.referenceType,
          referenceId: customerTransactions.referenceId,
          notes: customerTransactions.notes,
          createdAt: customerTransactions.createdAt,
          performedByName: users.fullName,
        })
        .from(customerTransactions)
        .leftJoin(users, eq(customerTransactions.performedBy, users.id))
        .where(and(...conds))
        .orderBy(desc(customerTransactions.createdAt), desc(customerTransactions.id))
        .limit(input.limit);
    }),

  /* ------------------------------- CREDIT MGMT ------------------------------- */

  /** Credit overview: every customer with outstanding debt or a limit. */
  creditOverview: permissionProcedure("credit.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(customers)
      .where(and(ne(customers.status, "INACTIVE"), or(sql`${customers.creditOutstanding} > 0`, sql`${customers.creditLimit} > 0`)))
      .orderBy(desc(customers.creditOutstanding));
    return {
      items: rows,
      stats: {
        totalOutstanding: Number(rows.reduce((s, r) => s + r.creditOutstanding, 0).toFixed(2)),
        debtors: rows.filter((r) => r.creditOutstanding > 0).length,
        overLimit: rows.filter((r) => r.creditLimit > 0 && r.creditOutstanding > r.creditLimit).length,
        totalLimit: Number(rows.reduce((s, r) => s + r.creditLimit, 0).toFixed(2)),
      },
    };
  }),

  /** Change a credit limit (credit.manage only — heavily audited). */
  setCreditLimit: permissionProcedure("credit.manage")
    .input(z.object({ customerId: z.number(), creditLimit: z.number().min(0), reason: z.string().min(3, "Give a reason").max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(customers).where(eq(customers.id, input.customerId)).limit(1);
      const existing = found[0];
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });

      await db.update(customers).set({ creditLimit: input.creditLimit }).where(eq(customers.id, input.customerId));

      await logAudit({
        actorId: ctx.user.id,
        action: "credit.limit_change",
        entityType: "CUSTOMER",
        entityId: input.customerId,
        description: `Changed "${existing.fullName}"'s credit limit from ₦${existing.creditLimit.toLocaleString()} to ₦${input.creditLimit.toLocaleString()} — ${input.reason}.`,
        beforeData: { creditLimit: existing.creditLimit },
        afterData: { creditLimit: input.creditLimit, reason: input.reason },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /** Manual correction of what a customer owes (credit.manage, reason mandatory). */
  adjustCredit: permissionProcedure("credit.manage")
    .input(
      z.object({
        customerId: z.number(),
        direction: z.enum(["INCREASE", "DECREASE"]),
        amount: z.number().positive("Amount must be greater than zero"),
        reason: z.string().min(3, "Give a reason for this adjustment").max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const signed = input.direction === "INCREASE" ? input.amount : -input.amount;
      const result = await db.transaction(async (tx) =>
        applyCustomerTx(tx, {
          customerId: input.customerId,
          transactionType: "ADJUSTMENT",
          creditDelta: signed,
          referenceType: "MANUAL",
          notes: input.reason,
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "credit.adjust",
        entityType: "CUSTOMER",
        entityId: input.customerId,
        description: `Adjusted "${result.customer.fullName}"'s outstanding by ${signed > 0 ? "+" : ""}₦${Math.abs(signed).toLocaleString()} — ${input.reason}. Outstanding now ₦${result.creditBalanceAfter.toLocaleString()}.`,
        afterData: { creditDelta: signed, creditBalanceAfter: result.creditBalanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, creditBalanceAfter: result.creditBalanceAfter };
    }),

  /* ------------------------------ DEPOSIT WALLET ------------------------------ */

  /** Deposits overview: customers holding money with us. */
  depositsOverview: permissionProcedure("deposits.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(customers)
      .where(and(ne(customers.status, "INACTIVE"), sql`${customers.depositBalance} > 0`))
      .orderBy(desc(customers.depositBalance));
    return {
      items: rows,
      stats: {
        totalHeld: Number(rows.reduce((s, r) => s + r.depositBalance, 0).toFixed(2)),
        holders: rows.length,
      },
    };
  }),

  /** Record an advance deposit from a customer. */
  recordDeposit: permissionProcedure("deposits.record")
    .input(
      z.object({
        customerId: z.number(),
        amount: z.number().positive("Amount must be greater than zero"),
        notes: z.string().max(500).optional().or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) =>
        applyCustomerTx(tx, {
          customerId: input.customerId,
          transactionType: "DEPOSIT_IN",
          depositDelta: input.amount,
          referenceType: "DEPOSIT",
          notes: input.notes || "Advance deposit received",
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "deposit.record",
        entityType: "CUSTOMER",
        entityId: input.customerId,
        description: `Recorded ₦${input.amount.toLocaleString()} advance deposit from "${result.customer.fullName}" — wallet now ₦${result.depositBalanceAfter.toLocaleString()}.`,
        afterData: { depositDelta: input.amount, depositBalanceAfter: result.depositBalanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, depositBalanceAfter: result.depositBalanceAfter };
    }),

  /** Pay deposit money back out to the customer. */
  refundDeposit: permissionProcedure("deposits.refund")
    .input(
      z.object({
        customerId: z.number(),
        amount: z.number().positive("Amount must be greater than zero"),
        reason: z.string().min(3, "Give a reason for this refund").max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async (tx) =>
        applyCustomerTx(tx, {
          customerId: input.customerId,
          transactionType: "DEPOSIT_REFUND",
          depositDelta: -input.amount,
          referenceType: "DEPOSIT",
          notes: input.reason,
          performedBy: ctx.user.id,
        }),
      );

      await logAudit({
        actorId: ctx.user.id,
        action: "deposit.refund",
        entityType: "CUSTOMER",
        entityId: input.customerId,
        description: `Refunded ₦${input.amount.toLocaleString()} from "${result.customer.fullName}"'s deposit wallet — ${input.reason}. Wallet now ₦${result.depositBalanceAfter.toLocaleString()}.`,
        afterData: { depositDelta: -input.amount, depositBalanceAfter: result.depositBalanceAfter },
        ...requestMeta(ctx.req),
      });
      return { ok: true, depositBalanceAfter: result.depositBalanceAfter };
    }),

  /** Count of credit/deposit accounts — for the dashboard. */
  accountCounts: anyPermissionProcedure(["customers.view", "credit.view", "deposits.view"]).query(async () => {
    const db = getDb();
    const [row] = await db
      .select({
        total: count(),
        withCredit: sql<number>`SUM(CASE WHEN ${customers.creditOutstanding} > 0 THEN 1 ELSE 0 END)`.as("with_credit"),
        withDeposit: sql<number>`SUM(CASE WHEN ${customers.depositBalance} > 0 THEN 1 ELSE 0 END)`.as("with_deposit"),
      })
      .from(customers)
      .where(ne(customers.status, "INACTIVE"));
    return {
      total: row?.total ?? 0,
      withCredit: Number(row?.withCredit ?? 0),
      withDeposit: Number(row?.withDeposit ?? 0),
    };
  }),
});
