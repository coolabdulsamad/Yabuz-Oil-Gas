import { and, count, eq, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  approvalRequests,
  customers,
  products,
  sales,
} from "@db/schema";

/**
 * YABUZ OIL & GAS — dashboard router
 * Headline numbers for the home screen. Grows richer as modules land.
 */
export const dashboardRouter = createRouter({
  stats: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();

    const [productCount] = await db.select({ value: count() }).from(products).where(eq(products.status, "ACTIVE"));
    const [customerCount] = await db.select({ value: count() }).from(customers).where(eq(customers.status, "ACTIVE"));
    const [pendingApprovals] = await db
      .select({ value: count() })
      .from(approvalRequests)
      .where(eq(approvalRequests.status, "PENDING"));

    // Low stock: active products at or below their reorder level.
    const lowStock = await db
      .select({ id: products.id, name: products.name, currentStock: products.currentStock, reorderLevel: products.reorderLevel })
      .from(products)
      .where(and(eq(products.status, "ACTIVE"), sql`${products.currentStock} <= ${products.reorderLevel}`))
      .limit(10);

    // Inventory valuation at cost and at selling price.
    const [valuation] = await db
      .select({
        costValue: sql<number>`COALESCE(SUM(${products.currentStock} * ${products.costCartonPrice}), 0)`,
        sellValue: sql<number>`COALESCE(SUM(${products.currentStock} * ${products.sellCartonPrice}), 0)`,
      })
      .from(products)
      .where(eq(products.status, "ACTIVE"));

    // Sales totals (all time for now; charting arrives with the reports module).
    const [salesTotals] = await db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${sales.grandTotal}), 0)`,
        totalSales: count(),
      })
      .from(sales);

    // Cost valuation reveals margins — only for roles allowed to see cost prices.
    const canSeeCost = ctx.permissions.has("prices.view_cost");

    return {
      productCount: productCount?.value ?? 0,
      customerCount: customerCount?.value ?? 0,
      pendingApprovals: pendingApprovals?.value ?? 0,
      lowStockCount: lowStock.length,
      lowStock,
      costValue: canSeeCost ? Number(valuation?.costValue ?? 0) : null,
      sellValue: Number(valuation?.sellValue ?? 0),
      totalRevenue: Number(salesTotals?.totalRevenue ?? 0),
      totalSales: salesTotals?.totalSales ?? 0,
      viewerRole: ctx.user.role,
    };
  }),
});
