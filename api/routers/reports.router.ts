import { z } from "zod";
import { and, asc, desc, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  customers,
  expenseCategories,
  expenses,
  payments,
  products,
  salaryPayments,
  saleItems,
  sales,
  salesExchanges,
  salesReturnItems,
  salesReturns,
  staffLoanRepayments,
  staffLoans,
  stockMovements,
  users,
} from "@db/schema";
import { parsePaymentMode } from "../services/payments.service";

/**
 * YABUZ OIL & GAS — reports router
 * Tabular, filterable business reports behind reports.view. Every report
 * returns detail rows plus a totals block so the UI can render both the
 * table and the headline strip (and the CSV export uses the same payload).
 *
 * Conventions:
 *  - Sales/payment reports are date-ranged on createdAt/confirmedAt
 *    (inclusive range; `to` is taken up to end-of-day).
 *  - Revenue counts COMPLETED sales only; drafts/pending/cancelled excluded.
 *  - Credit/deposit reports are point-in-time wallet snapshots.
 */

const rangeInput = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .optional();

function fromDate(s?: string) {
  return s ? new Date(`${s}T00:00:00`) : undefined;
}
/** Inclusive end-of-day for a YYYY-MM-DD bound. */
function toDate(s?: string) {
  return s ? new Date(`${s}T23:59:59.999`) : undefined;
}

export const reportsRouter = createRouter({
  /* ------------------------------ SALES REPORT ----------------------------- */

  salesReport: permissionProcedure("reports.view")
    .input(
      rangeInput.and(
        z
          .object({
            repId: z.number().int().positive().optional(),
            customerId: z.number().int().positive().optional(),
            status: z.enum(["ALL", "COMPLETED", "CANCELLED", "OPEN"]).default("COMPLETED"),
          })
          .optional(),
      ),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(sales.createdAt, from));
      if (to) conds.push(lte(sales.createdAt, to));
      if (input?.repId) conds.push(eq(sales.salesRepId, input.repId));
      if (input?.customerId) conds.push(eq(sales.customerId, input.customerId));
      const status = input?.status ?? "COMPLETED";
      if (status === "COMPLETED") conds.push(eq(sales.status, "COMPLETED"));
      else if (status === "CANCELLED") conds.push(eq(sales.status, "CANCELLED"));
      else if (status === "OPEN") conds.push(ne(sales.status, "COMPLETED"), ne(sales.status, "CANCELLED"));

      const rows = await db
        .select({
          id: sales.id,
          orderNo: sales.orderNo,
          createdAt: sales.createdAt,
          status: sales.status,
          paymentStatus: sales.paymentStatus,
          itemCount: sales.itemCount,
          subtotal: sales.subtotal,
          discountTotal: sales.discountTotal,
          grandTotal: sales.grandTotal,
          amountPaid: sales.amountPaid,
          balanceDue: sales.balanceDue,
          notes: sales.notes,
          repName: users.fullName,
          customerName: customers.fullName,
        })
        .from(sales)
        .leftJoin(users, eq(sales.salesRepId, users.id))
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(sales.createdAt))
        .limit(1000);

      const items = rows.map((r) => ({
        ...r,
        paymentMode: parsePaymentMode(r.notes),
        customerName: r.customerName ?? "Walk-in",
        notes: undefined,
      }));
      const totals = {
        count: items.length,
        subtotal: items.reduce((s, r) => s + Number(r.subtotal), 0),
        discount: items.reduce((s, r) => s + Number(r.discountTotal), 0),
        revenue: items.reduce((s, r) => s + Number(r.grandTotal), 0),
        collected: items.reduce((s, r) => s + Number(r.amountPaid), 0),
        outstanding: items.reduce((s, r) => s + Math.max(0, Number(r.balanceDue)), 0),
      };
      return { items, totals };
    }),

  /* ---------------------------- PRODUCT SALES ------------------------------ */

  productSalesReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [eq(sales.status, "COMPLETED")];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(sales.createdAt, from));
      if (to) conds.push(lte(sales.createdAt, to));

      const rows = await db
        .select({
          productId: saleItems.productId,
          productName: saleItems.productName,
          sku: saleItems.sku,
          packs: sql<number>`COALESCE(SUM(${saleItems.packsDeducted}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${saleItems.lineTotal}), 0)`,
          cost: sql<number>`COALESCE(SUM(${saleItems.packsDeducted} * ${saleItems.costPrice}), 0)`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(...conds))
        .groupBy(saleItems.productId, saleItems.productName, saleItems.sku)
        .orderBy(desc(sql`SUM(${saleItems.lineTotal})`));

      const items = rows.map((r) => {
        const revenue = Number(r.revenue);
        const cost = Number(r.cost);
        return {
          ...r,
          packs: Number(r.packs),
          revenue,
          cost,
          margin: revenue - cost,
          marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
        };
      });
      return {
        items,
        totals: {
          packs: items.reduce((s, r) => s + r.packs, 0),
          revenue: items.reduce((s, r) => s + r.revenue, 0),
          cost: items.reduce((s, r) => s + r.cost, 0),
          margin: items.reduce((s, r) => s + r.margin, 0),
        },
      };
    }),

  /* ------------------------------ REP SALES -------------------------------- */

  repSalesReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [eq(sales.status, "COMPLETED")];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(sales.createdAt, from));
      if (to) conds.push(lte(sales.createdAt, to));

      const rows = await db
        .select({
          repId: sales.salesRepId,
          repName: users.fullName,
          salesCount: sql<number>`COUNT(*)`,
          revenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
          collected: sql<number>`COALESCE(SUM(${sales.amountPaid}), 0)`,
          outstanding: sql<number>`COALESCE(SUM(GREATEST(${sales.balanceDue}, 0)), 0)`,
          discount: sql<number>`COALESCE(SUM(${sales.discountTotal}), 0)`,
        })
        .from(sales)
        .leftJoin(users, eq(sales.salesRepId, users.id))
        .where(and(...conds))
        .groupBy(sales.salesRepId, users.fullName)
        .orderBy(desc(sql`SUM(${sales.grandTotal})`));

      const items = rows.map((r) => ({
        ...r,
        salesCount: Number(r.salesCount),
        revenue: Number(r.revenue),
        collected: Number(r.collected),
        outstanding: Number(r.outstanding),
        discount: Number(r.discount),
      }));
      return {
        items,
        totals: {
          salesCount: items.reduce((s, r) => s + r.salesCount, 0),
          revenue: items.reduce((s, r) => s + r.revenue, 0),
          collected: items.reduce((s, r) => s + r.collected, 0),
          outstanding: items.reduce((s, r) => s + r.outstanding, 0),
        },
      };
    }),

  /* ----------------------------- PAYMENTS REPORT ---------------------------- */

  paymentsReport: permissionProcedure("reports.view")
    .input(
      rangeInput.and(
        z
          .object({
            paymentType: z.enum(["ALL", "SALE_PAYMENT", "CREDIT_PAYMENT", "ADVANCE_DEPOSIT", "DEPOSIT_REFUND"]).default("ALL"),
            method: z.enum(["ALL", "CASH", "BANK_TRANSFER", "POS", "CHEQUE"]).default("ALL"),
          })
          .optional(),
      ),
    )
    .query(async ({ input }) => {
      const db = getDb();
      // Confirmed money only, ranged on confirmation date.
      const conds: SQL[] = [eq(payments.status, "CONFIRMED")];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(payments.confirmedAt, from));
      if (to) conds.push(lte(payments.confirmedAt, to));
      if (input?.paymentType && input.paymentType !== "ALL") conds.push(eq(payments.paymentType, input.paymentType));
      if (input?.method && input.method !== "ALL") conds.push(eq(payments.method, input.method));

      const rows = await db
        .select({
          id: payments.id,
          reference: payments.reference,
          paymentType: payments.paymentType,
          method: payments.method,
          amount: payments.amount,
          appliedToSale: payments.appliedToSale,
          addedToDeposit: payments.addedToDeposit,
          externalReference: payments.externalReference,
          confirmedAt: payments.confirmedAt,
          customerName: customers.fullName,
          orderNo: sales.orderNo,
          recorderName: users.fullName,
        })
        .from(payments)
        .leftJoin(customers, eq(payments.customerId, customers.id))
        .leftJoin(sales, eq(payments.saleId, sales.id))
        .leftJoin(users, eq(payments.recordedBy, users.id))
        .where(and(...conds))
        .orderBy(desc(payments.confirmedAt))
        .limit(1000);

      const items = rows.map((r) => ({ ...r, customerName: r.customerName ?? "—" }));
      const moneyIn = items.filter((r) => r.paymentType !== "DEPOSIT_REFUND").reduce((s, r) => s + Number(r.amount), 0);
      const refunds = items.filter((r) => r.paymentType === "DEPOSIT_REFUND").reduce((s, r) => s + Number(r.amount), 0);
      const byMethod = new Map<string, number>();
      for (const r of items) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + Number(r.amount));
      return {
        items,
        totals: {
          count: items.length,
          moneyIn,
          refunds,
          net: moneyIn - refunds,
          byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
        },
      };
    }),

  /* ----------------------------- EXPENSES REPORT ---------------------------- */

  expensesReport: permissionProcedure("reports.view")
    .input(
      rangeInput.and(z.object({ categoryId: z.number().int().positive().optional() }).optional()),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [eq(expenses.status, "APPROVED")];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(expenses.expenseDate, from));
      if (to) conds.push(lte(expenses.expenseDate, to));
      if (input?.categoryId) conds.push(eq(expenses.categoryId, input.categoryId));

      const rows = await db
        .select({
          id: expenses.id,
          reference: expenses.reference,
          expenseDate: expenses.expenseDate,
          amount: expenses.amount,
          description: expenses.description,
          vendor: expenses.vendor,
          categoryName: expenseCategories.name,
          creatorName: users.fullName,
        })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
        .leftJoin(users, eq(expenses.createdBy, users.id))
        .where(and(...conds))
        .orderBy(desc(expenses.expenseDate), desc(expenses.id))
        .limit(1000);

      const byCategory = new Map<string, number>();
      for (const r of rows) byCategory.set(r.categoryName ?? "—", (byCategory.get(r.categoryName ?? "—") ?? 0) + Number(r.amount));
      return {
        items: rows,
        totals: {
          count: rows.length,
          amount: rows.reduce((s, r) => s + Number(r.amount), 0),
          byCategory: [...byCategory.entries()]
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount),
        },
      };
    }),

  /* ------------------------------ CREDIT REPORT ----------------------------- */

  creditReport: permissionProcedure("reports.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: customers.id,
        code: customers.code,
        fullName: customers.fullName,
        phone: customers.phone,
        creditLimit: customers.creditLimit,
        creditOutstanding: customers.creditOutstanding,
        totalSpent: customers.totalSpent,
        lastSaleAt: customers.lastSaleAt,
      })
      .from(customers)
      .where(and(eq(customers.status, "ACTIVE"), sql`(${customers.creditLimit} > 0 OR ${customers.creditOutstanding} > 0)`))
      .orderBy(desc(customers.creditOutstanding));

    const items = rows.map((r) => ({
      ...r,
      headroom: Number(r.creditLimit) - Number(r.creditOutstanding),
      utilizationPct: Number(r.creditLimit) > 0 ? (Number(r.creditOutstanding) / Number(r.creditLimit)) * 100 : null,
    }));
    return {
      items,
      totals: {
        accounts: items.length,
        limits: items.reduce((s, r) => s + Number(r.creditLimit), 0),
        outstanding: items.reduce((s, r) => s + Number(r.creditOutstanding), 0),
        headroom: items.reduce((s, r) => s + r.headroom, 0),
      },
    };
  }),

  /* ----------------------------- DEPOSITS REPORT ---------------------------- */

  depositsReport: permissionProcedure("reports.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: customers.id,
        code: customers.code,
        fullName: customers.fullName,
        phone: customers.phone,
        depositBalance: customers.depositBalance,
        totalSpent: customers.totalSpent,
        lastSaleAt: customers.lastSaleAt,
      })
      .from(customers)
      .where(and(eq(customers.status, "ACTIVE"), sql`${customers.depositBalance} > 0`))
      .orderBy(desc(customers.depositBalance));
    return {
      items: rows,
      totals: {
        accounts: rows.length,
        held: rows.reduce((s, r) => s + Number(r.depositBalance), 0),
      },
    };
  }),

  /* ----------------------------- INVENTORY REPORT --------------------------- */

  inventoryReport: permissionProcedure("reports.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        packDescription: products.packDescription,
        currentStock: products.currentStock,
        reorderLevel: products.reorderLevel,
        costCartonPrice: products.costCartonPrice,
        sellCartonPrice: products.sellCartonPrice,
        status: products.status,
      })
      .from(products)
      .where(eq(products.status, "ACTIVE"))
      .orderBy(asc(products.name));

    const items = rows.map((r) => ({
      ...r,
      costValue: Number(r.currentStock) * Number(r.costCartonPrice),
      sellValue: Number(r.currentStock) * Number(r.sellCartonPrice),
      lowStock: Number(r.currentStock) <= Number(r.reorderLevel),
    }));
    return {
      items,
      totals: {
        products: items.length,
        packs: items.reduce((s, r) => s + Number(r.currentStock), 0),
        costValue: items.reduce((s, r) => s + r.costValue, 0),
        sellValue: items.reduce((s, r) => s + r.sellValue, 0),
        lowStockCount: items.filter((r) => r.lowStock).length,
      },
    };
  }),

  /* ------------------------- STOCK MOVEMENTS REPORT ------------------------- */

  movementsReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(stockMovements.createdAt, from));
      if (to) conds.push(lte(stockMovements.createdAt, to));

      const rows = await db
        .select({
          id: stockMovements.id,
          createdAt: stockMovements.createdAt,
          movementType: stockMovements.movementType,
          quantity: stockMovements.quantity,
          balanceAfter: stockMovements.balanceAfter,
          referenceType: stockMovements.referenceType,
          reason: stockMovements.reason,
          productName: products.name,
          performerName: users.fullName,
        })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(users, eq(stockMovements.performedBy, users.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(1000);

      const stockIn = rows.filter((r) => Number(r.quantity) > 0).reduce((s, r) => s + Number(r.quantity), 0);
      const stockOut = rows.filter((r) => Number(r.quantity) < 0).reduce((s, r) => s + Math.abs(Number(r.quantity)), 0);
      return { items: rows, totals: { count: rows.length, stockIn, stockOut } };
    }),

  /* ------------------------------ PROFIT REPORT ----------------------------- */

  profitReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);

      const saleConds: SQL[] = [eq(sales.status, "COMPLETED")];
      if (from) saleConds.push(gte(sales.createdAt, from));
      if (to) saleConds.push(lte(sales.createdAt, to));

      const [rev] = await db
        .select({
          revenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
          discount: sql<number>`COALESCE(SUM(${sales.discountTotal}), 0)`,
          salesCount: sql<number>`COUNT(*)`,
          collected: sql<number>`COALESCE(SUM(${sales.amountPaid}), 0)`,
        })
        .from(sales)
        .where(and(...saleConds));

      const [cogs] = await db
        .select({
          cost: sql<number>`COALESCE(SUM(${saleItems.packsDeducted} * ${saleItems.costPrice}), 0)`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(...saleConds));

      const expConds: SQL[] = [eq(expenses.status, "APPROVED")];
      if (from) expConds.push(gte(expenses.expenseDate, from));
      if (to) expConds.push(lte(expenses.expenseDate, to));
      const [exp] = await db
        .select({ amount: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(and(...expConds));

      const revenue = Number(rev?.revenue ?? 0);
      const cost = Number(cogs?.cost ?? 0);
      const grossMargin = revenue - cost;
      const expenseTotal = Number(exp?.amount ?? 0);
      return {
        revenue,
        discount: Number(rev?.discount ?? 0),
        salesCount: Number(rev?.salesCount ?? 0),
        collected: Number(rev?.collected ?? 0),
        cogs: cost,
        grossMargin,
        grossMarginPct: revenue > 0 ? (grossMargin / revenue) * 100 : 0,
        expenses: expenseTotal,
        netMargin: grossMargin - expenseTotal,
        netMarginPct: revenue > 0 ? ((grossMargin - expenseTotal) / revenue) * 100 : 0,
      };
    }),

  /* ------------------------------ RETURNS REPORT ----------------------------- */

  returnsReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(salesReturns.createdAt, from));
      if (to) conds.push(lte(salesReturns.createdAt, to));

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
        .limit(1000);

      const itemCounts = await db
        .select({ returnId: salesReturnItems.returnId, qty: sql<number>`COALESCE(SUM(${salesReturnItems.quantity}), 0)` })
        .from(salesReturnItems)
        .groupBy(salesReturnItems.returnId);
      const qtyBy = new Map(itemCounts.map((r) => [r.returnId, Number(r.qty)]));

      const items = rows.map((r) => ({
        ...r.ret,
        orderNo: r.orderNo,
        customerName: r.customerName ?? "Walk-in",
        processorName: r.processorName,
        itemQty: qtyBy.get(r.ret.id) ?? 0,
      }));
      const completed = items.filter((i) => i.status === "COMPLETED");
      return {
        items,
        totals: {
          count: items.length,
          completedCount: completed.length,
          pendingCount: items.filter((i) => i.status === "PENDING_APPROVAL").length,
          totalValue: completed.reduce((s, r) => s + Number(r.totalAmount), 0),
          totalQty: completed.reduce((s, r) => s + r.itemQty, 0),
        },
      };
    }),

  /* ----------------------------- EXCHANGES REPORT ---------------------------- */

  exchangesReport: permissionProcedure("reports.view")
    .input(rangeInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      const from = fromDate(input?.dateFrom);
      const to = toDate(input?.dateTo);
      if (from) conds.push(gte(salesExchanges.createdAt, from));
      if (to) conds.push(lte(salesExchanges.createdAt, to));

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
        .limit(1000);

      const items = rows.map((r) => ({
        ...r.ex,
        orderNo: r.orderNo,
        customerName: r.customerName ?? "Walk-in",
        processorName: r.processorName,
      }));
      const completed = items.filter((i) => i.status === "COMPLETED");
      return {
        items,
        totals: {
          count: items.length,
          completedCount: completed.length,
          pendingCount: items.filter((i) => i.status === "PENDING_APPROVAL").length,
          returnedValue: completed.reduce((s, r) => s + Number(r.returnedTotal), 0),
          newValue: completed.reduce((s, r) => s + Number(r.newTotal), 0),
          topupsCollected: completed.filter((r) => Number(r.difference) > 0).reduce((s, r) => s + Number(r.difference), 0),
          creditedToDeposits: completed.filter((r) => Number(r.difference) < 0).reduce((s, r) => s - Number(r.difference), 0),
        },
      };
    }),

  /* ------------------------------ PAYROLL REPORT ----------------------------- */

  payrollReport: permissionProcedure("reports.view")
    .input(
      rangeInput.and(
        z
          .object({
            year: z.number().int().optional(),
            month: z.number().int().min(1).max(12).optional(),
          })
          .optional(),
      ),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.year) conds.push(eq(salaryPayments.periodYear, input.year));
      if (input?.month) conds.push(eq(salaryPayments.periodMonth, input.month));
      const rows = await db
        .select({
          pay: salaryPayments,
          staffName: users.fullName,
          staffCode: users.staffCode,
          role: users.role,
          department: users.department,
        })
        .from(salaryPayments)
        .innerJoin(users, eq(users.id, salaryPayments.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(salaryPayments.periodYear), desc(salaryPayments.periodMonth), asc(users.fullName))
        .limit(1000);

      const items = rows.map((r) => ({ ...r.pay, staffName: r.staffName, staffCode: r.staffCode, role: r.role, department: r.department }));
      const paid = items.filter((i) => i.status === "PAID");
      return {
        items,
        totals: {
          count: items.length,
          paidCount: paid.length,
          pendingCount: items.filter((i) => i.status === "PENDING").length,
          gross: paid.reduce((s, r) => s + Number(r.grossPay), 0),
          tax: paid.reduce((s, r) => s + Number(r.taxAmount), 0),
          pension: paid.reduce((s, r) => s + Number(r.pensionAmount), 0),
          vat: paid.reduce((s, r) => s + Number(r.vatAmount), 0),
          loanDeductions: paid.reduce((s, r) => s + Number(r.loanDeduction), 0),
          otherDeductions: paid.reduce((s, r) => s + Number(r.otherDeduction), 0),
          netPaid: paid.reduce((s, r) => s + Number(r.netPay), 0),
        },
      };
    }),

  /* ------------------------------- LOANS REPORT ------------------------------ */

  loansReport: permissionProcedure("reports.view").query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        loan: staffLoans,
        staffName: users.fullName,
        staffCode: users.staffCode,
      })
      .from(staffLoans)
      .innerJoin(users, eq(users.id, staffLoans.userId))
      .orderBy(desc(staffLoans.createdAt))
      .limit(1000);

    const repayCounts = await db
      .select({ loanId: staffLoanRepayments.loanId, paid: sql<number>`COALESCE(SUM(${staffLoanRepayments.amount}), 0)`, cnt: sql<number>`COUNT(*)` })
      .from(staffLoanRepayments)
      .groupBy(staffLoanRepayments.loanId);
    const byLoan = new Map(repayCounts.map((r) => [r.loanId, { paid: Number(r.paid), cnt: Number(r.cnt) }]));

    const items = rows.map((r) => ({
      ...r.loan,
      staffName: r.staffName,
      staffCode: r.staffCode,
      installmentCount: byLoan.get(r.loan.id)?.cnt ?? 0,
    }));
    const active = items.filter((i) => i.status === "ACTIVE");
    return {
      items,
      totals: {
        count: items.length,
        activeCount: active.length,
        disbursed: items.filter((i) => i.status !== "REJECTED" && i.status !== "CANCELLED").reduce((s, r) => s + Number(r.amount), 0),
        recovered: items.reduce((s, r) => s + Number(r.amountRepaid), 0),
        outstanding: active.reduce((s, r) => s + Number(r.remainingBalance), 0),
      },
    };
  }),
});
