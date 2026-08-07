import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth.router";
import { dashboardRouter } from "./routers/dashboard.router";
import { usersRouter } from "./routers/users.router";
import { accessRouter } from "./routers/access.router";
import { settingsRouter } from "./routers/settings.router";
import { productsRouter } from "./routers/products.router";
import { priceListsRouter } from "./routers/pricelists.router";
import { inventoryRouter } from "./routers/inventory.router";
import { purchasesRouter } from "./routers/purchases.router";
import { customersRouter } from "./routers/customers.router";
import { salesRouter } from "./routers/sales.router";
import { returnsRouter } from "./routers/returns.router";
import { exchangesRouter } from "./routers/exchanges.router";
import { salaryRouter } from "./routers/salary.router";
import { loansRouter } from "./routers/loans.router";
import { approvalsRouter } from "./routers/approvals.router";
import { paymentsRouter } from "./routers/payments.router";
import { expensesRouter } from "./routers/expenses.router";
import { reportsRouter } from "./routers/reports.router";
import { analyticsRouter } from "./routers/analytics.router";
import { chatRouter } from "./routers/chat.router";
import { aiRouter } from "./routers/ai.router";
import { auditRouter } from "./routers/audit.router";
import { notificationsRouter } from "./routers/notifications.router";
import { moneyRouter } from "./routers/money.router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  auth: authRouter,
  dashboard: dashboardRouter,
  users: usersRouter,
  access: accessRouter,
  settings: settingsRouter,
  products: productsRouter,
  priceLists: priceListsRouter,
  inventory: inventoryRouter,
  purchases: purchasesRouter,
  customers: customersRouter,
  sales: salesRouter,
  returns: returnsRouter,
  exchanges: exchangesRouter,
  salary: salaryRouter,
  loans: loansRouter,
  approvals: approvalsRouter,
  payments: paymentsRouter,
  expenses: expensesRouter,
  reports: reportsRouter,
  analytics: analyticsRouter,
  chat: chatRouter,
  ai: aiRouter,
  audit: auditRouter,
  notifications: notificationsRouter,
  money: moneyRouter,
});

export type AppRouter = typeof appRouter;
