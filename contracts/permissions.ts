import type { UserRole } from "./roles";

/**
 * YABUZ OIL & GAS — Permission catalog (shared frontend ↔ backend)
 * Every gated action in the app maps to one of these keys.
 * Admin/Super Admin toggle them per role; per-user overrides live in
 * user_permissions (grant a key a role lacks, or revoke one it has).
 */
export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // ---- DASHBOARD ----
  { key: "dashboard.view", label: "View dashboard", group: "Dashboard", description: "See the main dashboard with totals and charts." },

  // ---- SALES ----
  { key: "sales.view", label: "View sales", group: "Sales", description: "Open the sales module." },
  { key: "sales.view_all", label: "View everyone's sales", group: "Sales", description: "See sales made by all staff, not just your own." },
  { key: "sales.view_details", label: "Sale details", group: "Sales", description: "Open the full details page of a sale." },
  { key: "sales.create", label: "Make sales", group: "Sales", description: "Create a new sale (goes through the approval workflow)." },
  { key: "sales.hold", label: "Hold & resume sales", group: "Sales", description: "Park a sale on hold and resume it later." },
  { key: "sales.apply_discount", label: "Apply discounts", group: "Sales", description: "Discount a sale line or the whole sale." },
  { key: "sales.override_price", label: "Override prices", group: "Sales", description: "Manually change a product's selling price on a sale." },
  { key: "sales.sell_on_credit", label: "Sell on credit", group: "Sales", description: "Complete a sale without full payment (customer owes the balance)." },
  { key: "sales.cancel", label: "Cancel sales", group: "Sales", description: "Cancel/void a sale (stock is restored; may require approval)." },

  // ---- RETURNS & EXCHANGES ----
  { key: "returns.view", label: "View returns", group: "Returns & Exchanges", description: "See item/sale returns and their status." },
  { key: "returns.create", label: "Process returns", group: "Returns & Exchanges", description: "Return items or a whole sale — the value goes into the customer's advance deposit wallet (goes through approval workflow)." },
  { key: "exchanges.view", label: "View exchanges", group: "Returns & Exchanges", description: "See item exchanges and their status." },
  { key: "exchanges.create", label: "Process exchanges", group: "Returns & Exchanges", description: "Swap sold items for new ones — customer tops up by cash/transfer/POS/cheque/credit/deposit, or the difference goes to their deposit wallet (goes through approval workflow)." },

  // ---- PAYROLL & LOANS ----
  { key: "salary.view", label: "View payroll", group: "Payroll & Loans", description: "See salary configurations, payroll history and payslips." },
  { key: "salary.manage", label: "Manage payroll", group: "Payroll & Loans", description: "Configure staff salaries, generate payroll and record salary payments (Admin & Super Admin only)." },
  { key: "loans.view", label: "View staff loans", group: "Payroll & Loans", description: "See staff loans, balances and deduction schedules." },
  { key: "loans.manage", label: "Manage staff loans", group: "Payroll & Loans", description: "Grant loans to staff and manage salary-deduction repayment (Admin & Super Admin only)." },

  // ---- PAYMENTS ----
  { key: "payments.view", label: "View payments", group: "Payments", description: "Open the payments module." },
  { key: "payments.view_all", label: "View all payments", group: "Payments", description: "See payments recorded by all staff." },
  { key: "payments.record", label: "Record payments", group: "Payments", description: "Record a customer payment with proof (goes through approval workflow)." },
  { key: "payments.confirm", label: "Confirm payments", group: "Payments", description: "Confirm or reject a recorded payment after checking its proof." },

  // ---- CREDIT & DEPOSITS ----
  { key: "credit.view", label: "View credit", group: "Credit & Deposits", description: "See customer credit balances and outstanding debts." },
  { key: "credit.manage", label: "Manage credit limits", group: "Credit & Deposits", description: "Set or change a customer's credit limit (may require approval)." },
  { key: "deposits.view", label: "View deposits", group: "Credit & Deposits", description: "See customers' advance deposit balances and history." },
  { key: "deposits.record", label: "Record deposits", group: "Credit & Deposits", description: "Record an advance deposit from a customer." },
  { key: "deposits.refund", label: "Refund deposits", group: "Credit & Deposits", description: "Pay deposit money back to a customer (requires approval)." },

  // ---- PRODUCTS & PRICES ----
  { key: "products.view", label: "View products", group: "Products & Prices", description: "Browse the product catalog and details." },
  { key: "products.create", label: "Add products", group: "Products & Prices", description: "Create new products (may require approval)." },
  { key: "products.edit", label: "Edit products", group: "Products & Prices", description: "Modify product details (may require approval)." },
  { key: "products.delete", label: "Delete products", group: "Products & Prices", description: "Archive/delete products (requires approval)." },
  { key: "products.manage_categories", label: "Manage categories", group: "Products & Prices", description: "Create/edit product categories." },
  { key: "prices.view_cost", label: "View cost prices", group: "Products & Prices", description: "See producer (cost) prices and margins — not just selling prices." },
  { key: "prices.manage", label: "Manage price lists", group: "Products & Prices", description: "Create and publish batch price lists (requires approval)." },

  // ---- INVENTORY ----
  { key: "inventory.view", label: "View inventory", group: "Inventory", description: "View stock levels, valuation and movement history." },
  { key: "inventory.stock_in", label: "Record supplies", group: "Inventory", description: "Receive stock into the store (supplies from Polar)." },
  { key: "inventory.stock_out", label: "Record stock-out", group: "Inventory", description: "Record stock leaving (damage, manual out)." },
  { key: "inventory.adjust", label: "Stock adjustments", group: "Inventory", description: "Correct stock balances (requires approval)." },
  { key: "inventory.stock_count", label: "Stock counts", group: "Inventory", description: "Run physical stock-taking sessions." },
  { key: "inventory.manage_suppliers", label: "Manage suppliers", group: "Inventory", description: "Create/edit supplier records." },
  { key: "inventory.manage_purchases", label: "Manage purchase orders", group: "Inventory", description: "Create and receive purchase orders." },

  // ---- CUSTOMERS ----
  { key: "customers.view", label: "View customers", group: "Customers", description: "View customer records and account statements." },
  { key: "customers.manage", label: "Manage customers", group: "Customers", description: "Create and edit customer profiles." },

  // ---- EXPENSES ----
  { key: "expenses.view", label: "View expenses", group: "Expenses", description: "View expense records." },
  { key: "expenses.create", label: "Record expenses", group: "Expenses", description: "Record a business expense (goes through approval workflow)." },
  { key: "expenses.manage_categories", label: "Expense categories", group: "Expenses", description: "Create/edit expense categories." },

  // ---- REPORTS & ANALYTICS ----
  { key: "reports.view", label: "View reports", group: "Reports & Analytics", description: "Access sales, inventory, credit and financial reports." },
  { key: "reports.export", label: "Export reports", group: "Reports & Analytics", description: "Download reports as CSV/Excel." },
  { key: "analytics.view", label: "View analytics", group: "Reports & Analytics", description: "Access the analytics dashboards and charts." },

  // ---- USERS & ACCESS ----
  { key: "users.view", label: "View staff", group: "Users & Access", description: "View staff accounts." },
  { key: "users.manage", label: "Manage staff", group: "Users & Access", description: "Create, edit and suspend staff within your hierarchy (manager → sales, admin → managers)." },
  { key: "permissions.manage", label: "Manage permissions", group: "Users & Access", description: "Change what each role can do and set per-user overrides." },

  // ---- APPROVALS ----
  { key: "approvals.request", label: "Submit approval requests", group: "Approvals", description: "Send actions into the approval workflow." },
  { key: "approvals.review", label: "Review approvals", group: "Approvals", description: "Approve or reject requests waiting on your step of the chain." },

  // ---- CHAT & AI ----
  { key: "chat.use", label: "Team chat", group: "Chat & AI", description: "Send messages, attachments and references." },
  { key: "ai.use", label: "AI assistant", group: "Chat & AI", description: "Ask the AI questions about company data." },

  // ---- SETTINGS & AUDIT ----
  { key: "settings.business", label: "Business settings", group: "Settings", description: "Company profile, currency, receipt and sales configuration." },
  { key: "settings.workflow", label: "Workflow settings", group: "Settings", description: "Configure approval chains (e.g. sales → manager → admin)." },
  { key: "settings.system", label: "System settings", group: "Settings", description: "Core system configuration (Super Admin only)." },
  { key: "audit.view", label: "View audit logs", group: "Settings", description: "Inspect the full activity audit trail." },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Default permission set granted to each role (seeded into role_permissions; Admin can edit). */
const SALES_DEFAULTS = [
  "dashboard.view",
  "sales.view",
  "sales.view_details",
  "sales.create",
  "sales.hold",
  "sales.apply_discount",
  "payments.view",
  "payments.record",
  "credit.view",
  "deposits.view",
  "deposits.record",
  "products.view",
  "inventory.view",
  "customers.view",
  "customers.manage",
  "returns.view",
  "returns.create",
  "exchanges.view",
  "exchanges.create",
  "chat.use",
];

const MANAGER_DEFAULTS = [
  ...SALES_DEFAULTS,
  "sales.view_all",
  "sales.override_price",
  "sales.sell_on_credit",
  "sales.cancel",
  "payments.view_all",
  "payments.confirm",
  "credit.manage",
  "deposits.refund",
  "products.create",
  "products.edit",
  "products.manage_categories",
  "prices.view_cost",
  "prices.manage",
  "inventory.stock_in",
  "inventory.stock_out",
  "inventory.adjust",
  "inventory.stock_count",
  "inventory.manage_suppliers",
  "inventory.manage_purchases",
  "expenses.view",
  "expenses.create",
  "expenses.manage_categories",
  "reports.view",
  "reports.export",
  "analytics.view",
  "users.view",
  "users.manage",
  "approvals.request",
  "approvals.review",
  "ai.use",
];

const ADMIN_DEFAULTS = [
  ...MANAGER_DEFAULTS,
  "products.delete",
  "permissions.manage",
  "settings.business",
  "settings.workflow",
  "audit.view",
  "salary.view",
  "salary.manage",
  "loans.view",
  "loans.manage",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SALES: SALES_DEFAULTS,
  MANAGER: MANAGER_DEFAULTS,
  ADMIN: ADMIN_DEFAULTS,
  SUPER_ADMIN: PERMISSION_KEYS, // developer-level: everything incl. settings.system
};

/**
 * Actions that ALWAYS go through the approval workflow when performed by
 * roles below ADMIN, regardless of permissions. Admin/Super Admin may
 * still be gated by the configured approval chain (settings.workflow).
 */
export const APPROVAL_GATED_PERMISSIONS = [
  "sales.create",
  "sales.cancel",
  "payments.record",
  "deposits.record",
  "deposits.refund",
  "expenses.create",
  "products.create",
  "products.edit",
  "products.delete",
  "prices.manage",
  "inventory.adjust",
  "inventory.stock_count",
  "inventory.manage_purchases",
  "credit.manage",
  "returns.create",
  "exchanges.create",
] as const;
