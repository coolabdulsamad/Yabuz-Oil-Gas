import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  json,
  boolean,
  int,
  bigint,
  decimal,
  timestamp,
  date,
  index,
  uniqueIndex,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import {
  USER_ROLES,
  USER_STATUSES,
  PRODUCT_STATUSES,
  PACK_TYPES,
  APPROVAL_STATUSES,
  SALE_STATUSES,
  SALE_PAYMENT_STATUSES,
  PAYMENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  CUSTOMER_TRANSACTION_TYPES,
  STOCK_MOVEMENT_TYPES,
  STOCK_COUNT_STATUSES,
  PURCHASE_STATUSES,
  EXPENSE_STATUSES,
  APPROVAL_FLOW_ENTITIES,
  APPROVAL_TYPES,
  APPROVAL_REQUEST_STATUSES,
  APPROVAL_STEP_STATUSES,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  CONVERSATION_TYPES,
  MESSAGE_REFERENCE_TYPES,
  ATTACHMENT_TYPES,
  AI_MESSAGE_ROLES,
  RETURN_STATUSES,
  EXCHANGE_STATUSES,
  EXCHANGE_SETTLEMENTS,
  SALARY_PAYMENT_STATUSES,
  SALARY_PAYMENT_METHODS,
  LOAN_STATUSES,
  MONEY_METHODS,
  MONEY_DIRECTIONS,
} from "@contracts/index";

/* ======================================================================
   YABUZ OIL & GAS — Database schema
   Oil & lubricants distribution: products bought from Polar Petrochemicals
   at producer price, resold to customers at marketer price.

   34 tables: identity & access, catalog & price lists, purchasing,
   inventory, customers & wallets (credit + advance deposits), sales,
   payments with proofs, expenses, configurable approval workflows,
   team chat, AI assistant, settings, notifications, audit log.
   ====================================================================== */

/* ============================ 1. USERS & ACCESS ============================ */

export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 60 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 160 }),
    phone: varchar("phone", { length: 40 }),
    role: mysqlEnum("role", USER_ROLES).notNull().default("SALES"),
    status: mysqlEnum("status", USER_STATUSES).notNull().default("ACTIVE"),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    staffCode: varchar("staff_code", { length: 20 }).unique(), // e.g. YOG-0001
    /* ----- Staff profile (payroll & HR) ----- */
    department: varchar("department", { length: 120 }), // Sales, Operations, Accounts…
    jobTitle: varchar("job_title", { length: 120 }), // e.g. Sales Representative
    dateEmployed: date("date_employed"),
    homeAddress: text("home_address"),
    nextOfKinName: varchar("next_of_kin_name", { length: 160 }),
    nextOfKinPhone: varchar("next_of_kin_phone", { length: 40 }),
    /* ----- Bank details — used when paying salaries ----- */
    bankName: varchar("bank_name", { length: 120 }),
    bankAccountNumber: varchar("bank_account_number", { length: 20 }),
    bankAccountName: varchar("bank_account_name", { length: 160 }),
    notes: text("notes"),
    lastLoginAt: timestamp("last_login_at"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(
      (): AnyMySqlColumn => users.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_users_role").on(t.role), index("idx_users_status").on(t.status)],
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // random session id
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sessions_user").on(t.userId), index("idx_sessions_expires").on(t.expiresAt)],
);

/** What each ROLE may do by default (seeded; Admin edits in Permission Management). */
export const rolePermissions = mysqlTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    role: mysqlEnum("role", USER_ROLES).notNull(),
    permissionKey: varchar("permission_key", { length: 100 }).notNull(),
    allowed: boolean("allowed").notNull().default(true),
    updatedBy: bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_role_permission").on(t.role, t.permissionKey)],
);

/** Per-user overrides on top of their role (grant or revoke for one person). */
export const userPermissions = mysqlTable(
  "user_permissions",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 100 }).notNull(),
    allowed: boolean("allowed").notNull().default(true),
    grantedBy: bigint("granted_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_user_permission").on(t.userId, t.permissionKey)],
);

/* ====================== 2. CATEGORIES, SUPPLIERS, PRODUCTS ====================== */

export const categories = mysqlTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 10 }).notNull().unique(), // A … I from the price list
    name: varchar("name", { length: 160 }).notNull().unique(), // POLAR ALVA 5000 XP
    description: text("description"),
    imageUrl: varchar("image_url", { length: 500 }),
    sortOrder: int("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
);

export const suppliers = mysqlTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(), // POLAR PETROCHEMICALS LIMITED
  contactPerson: varchar("contact_person", { length: 160 }),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 160 }),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const products = mysqlTable(
  "products",
  {
    id: serial("id").primaryKey(),
    sku: varchar("sku", { length: 50 }).notNull().unique(), // e.g. ALVA-1L-CTN
    barcode: varchar("barcode", { length: 64 }).unique(),
    name: varchar("name", { length: 255 }).notNull(), // ALVA 5000 XP 1LTS (12 GALLONS)
    description: text("description"),
    categoryId: bigint("category_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    supplierId: bigint("supplier_id", { mode: "number", unsigned: true }).references(
      () => suppliers.id,
      { onDelete: "set null" },
    ),
    /** Packing: CARTON of 12 gallons, 1 KEG, 1 DRUM… */
    packType: mysqlEnum("pack_type", PACK_TYPES).notNull().default("CARTON"),
    packDescription: varchar("pack_description", { length: 120 }).notNull(), // "1LTS (12 GALLONS)"
    /** Inner units inside one pack: 12 gallons per carton, 1 per drum… */
    unitsPerPack: decimal("units_per_pack", { precision: 10, scale: 3, mode: "number" })
      .notNull()
      .default(1),
    unitLabel: varchar("unit_label", { length: 40 }).notNull().default("GALLON"), // GALLON | KEG | DRUM | CUP | RUBBER
    /** Litres/Kg per inner unit (1L gallon, 0.2kg cup, 225L drum…) */
    volumePerUnit: decimal("volume_per_unit", { precision: 10, scale: 3, mode: "number" }),
    /** Current prices — refreshed whenever a price list is published. */
    costCartonPrice: decimal("cost_carton_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0), // producer carton/keg price
    costUnitPrice: decimal("cost_unit_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    sellCartonPrice: decimal("sell_carton_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0), // marketer carton/keg price
    sellUnitPrice: decimal("sell_unit_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Sell by inner unit too (single gallons/cups out of a carton)? */
    allowUnitSales: boolean("allow_unit_sales").notNull().default(true),
    reorderLevel: decimal("reorder_level", { precision: 14, scale: 3, mode: "number" })
      .notNull()
      .default(0),
    /** Cached live balance in PACKS. Source of truth = stock_movements. */
    currentStock: decimal("current_stock", { precision: 14, scale: 3, mode: "number" })
      .notNull()
      .default(0),
    storeLocation: varchar("store_location", { length: 80 }),
    primaryImageUrl: varchar("primary_image_url", { length: 500 }),
    status: mysqlEnum("status", PRODUCT_STATUSES).notNull().default("ACTIVE"),
    approvalStatus: mysqlEnum("approval_status", APPROVAL_STATUSES).notNull().default("NONE"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_products_category").on(t.categoryId),
    index("idx_products_status").on(t.status),
    index("idx_products_name").on(t.name),
  ],
);

export const productImages = mysqlTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 500 }).notNull(), // Cloudinary URL
    publicId: varchar("public_id", { length: 255 }), // Cloudinary public id (for delete)
    sortOrder: int("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_product_images_product").on(t.productId)],
);

/* ============================ 3. PRICE LISTS (BATCHES) ============================ */

/** Versioned price lists from Polar — "BATCH A", "BATCH B"… Publishing one updates product prices. */
export const priceLists = mysqlTable(
  "price_lists",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 60 }).notNull().unique(), // BATCH A
    description: text("description"),
    isActive: boolean("is_active").notNull().default(false), // only one active at a time
    approvalStatus: mysqlEnum("approval_status", APPROVAL_STATUSES).notNull().default("PENDING"),
    effectiveFrom: timestamp("effective_from"),
    publishedBy: bigint("published_by", { mode: "number", unsigned: true }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    publishedAt: timestamp("published_at"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
);

export const priceListItems = mysqlTable(
  "price_list_items",
  {
    id: serial("id").primaryKey(),
    priceListId: bigint("price_list_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    producerCartonPrice: decimal("producer_carton_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    producerUnitPrice: decimal("producer_unit_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    marketerCartonPrice: decimal("marketer_carton_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    marketerUnitPrice: decimal("marketer_unit_price", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Convenience snapshots: marketer − producer. */
    cartonGain: decimal("carton_gain", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    unitGain: decimal("unit_gain", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** Previous marketer carton price (the "OLD PRICE" column in the sheets). */
    oldPrice: decimal("old_price", { precision: 14, scale: 2, mode: "number" }),
  },
  (t) => [uniqueIndex("uq_pricelist_product").on(t.priceListId, t.productId)],
);

/* ============================ 4. PURCHASING (SUPPLIES FROM POLAR) ============================ */

export const purchases = mysqlTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // PO-000001
    supplierId: bigint("supplier_id", { mode: "number", unsigned: true }).references(
      () => suppliers.id,
      { onDelete: "set null" },
    ),
    status: mysqlEnum("status", PURCHASE_STATUSES).notNull().default("PENDING"),
    subtotal: decimal("subtotal", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    totalCost: decimal("total_cost", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    notes: text("notes"),
    expectedAt: date("expected_at"),
    receivedAt: timestamp("received_at"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_purchases_supplier").on(t.supplierId), index("idx_purchases_status").on(t.status)],
);

export const purchaseItems = mysqlTable(
  "purchase_items",
  {
    id: serial("id").primaryKey(),
    purchaseId: bigint("purchase_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(), // packs
    unitCost: decimal("unit_cost", { precision: 14, scale: 2, mode: "number" }).notNull(), // producer carton price
    lineTotal: decimal("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
    receivedQty: decimal("received_qty", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
  },
  (t) => [index("idx_purchase_items_purchase").on(t.purchaseId)],
);

/* ============================ 5. INVENTORY ============================ */

/** Immutable ledger of every stock change — the source of truth for balances. */
export const stockMovements = mysqlTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    movementType: mysqlEnum("movement_type", STOCK_MOVEMENT_TYPES).notNull(),
    /** Signed: + in, − out. In PACKS. */
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 14, scale: 3, mode: "number" }).notNull(),
    referenceType: varchar("reference_type", { length: 40 }), // SALE | PURCHASE | ADJUSTMENT | COUNT | RETURN
    referenceId: bigint("reference_id", { mode: "number", unsigned: true }),
    reason: varchar("reason", { length: 255 }),
    notes: text("notes"),
    performedBy: bigint("performed_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_movements_product").on(t.productId),
    index("idx_movements_type").on(t.movementType),
    index("idx_movements_created").on(t.createdAt),
    index("idx_movements_ref").on(t.referenceType, t.referenceId),
  ],
);

export const stockCounts = mysqlTable("stock_counts", {
  id: serial("id").primaryKey(),
  reference: varchar("reference", { length: 30 }).notNull().unique(), // SC-000001
  status: mysqlEnum("status", STOCK_COUNT_STATUSES).notNull().default("IN_PROGRESS"),
  notes: text("notes"),
  startedBy: bigint("started_by", { mode: "number", unsigned: true }).references(() => users.id, {
    onDelete: "set null",
  }),
  approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
    onDelete: "set null",
  }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const stockCountItems = mysqlTable(
  "stock_count_items",
  {
    id: serial("id").primaryKey(),
    countId: bigint("count_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    expectedQty: decimal("expected_qty", { precision: 14, scale: 3, mode: "number" }).notNull(),
    countedQty: decimal("counted_qty", { precision: 14, scale: 3, mode: "number" }),
    variance: decimal("variance", { precision: 14, scale: 3, mode: "number" }),
    /** Selling unit price snapshotted when the count started — values the variance. */
    unitPrice: decimal("unit_price", { precision: 14, scale: 2, mode: "number" }),
    notes: varchar("notes", { length: 255 }),
  },
  (t) => [index("idx_count_items_count").on(t.countId)],
);

/* ================= 6. CUSTOMERS, CREDIT & ADVANCE DEPOSITS ================= */

export const customers = mysqlTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(), // CUST-0001
    fullName: varchar("full_name", { length: 160 }).notNull(),
    customerType: mysqlEnum("customer_type", CUSTOMER_TYPES).notNull().default("BUSINESS"),
    businessName: varchar("business_name", { length: 160 }),
    contactPerson: varchar("contact_person", { length: 160 }),
    phone: varchar("phone", { length: 40 }),
    altPhone: varchar("alt_phone", { length: 40 }),
    email: varchar("email", { length: 160 }),
    website: varchar("website", { length: 160 }),
    /** Tax Identification Number (TIN) — printed on receipts/invoices. */
    tin: varchar("tin", { length: 60 }),
    /** CAC registration number for business customers. */
    rcNumber: varchar("rc_number", { length: 60 }),
    address: text("address"),
    /** Where goods get delivered, if different from the billing address. */
    deliveryAddress: text("delivery_address"),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 100 }),
    country: varchar("country", { length: 100 }).default("Nigeria"),
    notes: text("notes"),
    /** Maximum outstanding credit allowed; 0 = must pay in full. */
    creditLimit: decimal("credit_limit", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Cached current debt (what the customer owes us). Source of truth = customer_transactions. */
    creditOutstanding: decimal("credit_outstanding", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Cached advance deposit wallet (money the customer holds with us). */
    depositBalance: decimal("deposit_balance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    totalSpent: decimal("total_spent", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    lastSaleAt: timestamp("last_sale_at"),
    status: mysqlEnum("status", CUSTOMER_STATUSES).notNull().default("ACTIVE"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_customers_phone").on(t.phone), index("idx_customers_name").on(t.fullName)],
);

/**
 * Double-purpose customer ledger: every movement of credit (outstanding)
 * and/or deposit wallet. One row can touch either or both balances.
 */
export const customerTransactions = mysqlTable(
  "customer_transactions",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    transactionType: mysqlEnum("transaction_type", CUSTOMER_TRANSACTION_TYPES).notNull(),
    /** Change applied to creditOutstanding (e.g. +50000 on credit sale, −50000 on repayment). */
    creditDelta: decimal("credit_delta", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Change applied to depositBalance (+ in, − used/refunded). */
    depositDelta: decimal("deposit_delta", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    creditBalanceAfter: decimal("credit_balance_after", { precision: 14, scale: 2, mode: "number" }).notNull(),
    depositBalanceAfter: decimal("deposit_balance_after", { precision: 14, scale: 2, mode: "number" }).notNull(),
    referenceType: varchar("reference_type", { length: 40 }), // SALE | PAYMENT | DEPOSIT | MANUAL
    referenceId: bigint("reference_id", { mode: "number", unsigned: true }),
    notes: text("notes"),
    performedBy: bigint("performed_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_cust_tx_customer").on(t.customerId),
    index("idx_cust_tx_type").on(t.transactionType),
    index("idx_cust_tx_ref").on(t.referenceType, t.referenceId),
    index("idx_cust_tx_created").on(t.createdAt),
  ],
);

/* ============================ 7. SALES ============================ */

export const sales = mysqlTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    orderNo: varchar("order_no", { length: 30 }).notNull().unique(), // SO-20260731-0001
    salesRepId: bigint("sales_rep_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(
      () => customers.id,
      { onDelete: "set null" },
    ),
    status: mysqlEnum("status", SALE_STATUSES).notNull().default("DRAFT"),
    itemCount: int("item_count").notNull().default(0),
    subtotal: decimal("subtotal", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    discountTotal: decimal("discount_total", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    discountNote: varchar("discount_note", { length: 255 }),
    grandTotal: decimal("grand_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** Total confirmed payments applied to this sale. */
    amountPaid: decimal("amount_paid", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** grandTotal − amountPaid (can go negative → overpayment flows to deposit). */
    balanceDue: decimal("balance_due", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    paymentStatus: mysqlEnum("payment_status", SALE_PAYMENT_STATUSES).notNull().default("UNPAID"),
    /** true when this sale drew from the customer's deposit wallet. */
    usedDeposit: boolean("used_deposit").notNull().default(false),
    notes: text("notes"),
    heldAt: timestamp("held_at"),
    submittedAt: timestamp("submitted_at"), // entered the approval workflow
    finalApprovedBy: bigint("final_approved_by", { mode: "number", unsigned: true }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    finalApprovedAt: timestamp("final_approved_at"),
    completedAt: timestamp("completed_at"), // stock released
    cancelledBy: bigint("cancelled_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    cancelReason: varchar("cancel_reason", { length: 255 }),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_sales_rep").on(t.salesRepId),
    index("idx_sales_customer").on(t.customerId),
    index("idx_sales_status").on(t.status),
    index("idx_sales_created").on(t.createdAt),
  ],
);

export const saleItems = mysqlTable(
  "sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: bigint("sale_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    // Snapshots — records stay correct even if the product/price changes later:
    productName: varchar("product_name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 50 }).notNull(),
    packDescription: varchar("pack_description", { length: 120 }).notNull(),
    /** true = sold in inner units (single gallons/cups); false = whole packs. */
    soldAsUnits: boolean("sold_as_units").notNull().default(false),
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    /** Stock deduction in PACKS (units ÷ unitsPerPack when soldAsUnits). */
    packsDeducted: decimal("packs_deducted", { precision: 14, scale: 3, mode: "number" }).notNull(),
    unitPrice: decimal("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(), // per pack or per inner unit
    costPrice: decimal("cost_price", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    discountAmount: decimal("discount_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    lineTotal: decimal("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [index("idx_sale_items_sale").on(t.saleId), index("idx_sale_items_product").on(t.productId)],
);

/* ===================== 7b. SALES RETURNS & EXCHANGES ===================== */

/**
 * A customer returning items from a completed sale — some items or the
 * whole sale. On final approval the stock goes back in (restock) and the
 * returned value lands in the customer's advance deposit wallet (first
 * clearing any outstanding credit). From there it can be refunded via
 * the normal deposit-refund payment flow.
 */
export const salesReturns = mysqlTable(
  "sales_returns",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // RTN-000001
    saleId: bigint("sale_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(
      () => customers.id,
      { onDelete: "restrict" },
    ),
    status: mysqlEnum("status", RETURN_STATUSES).notNull().default("PENDING_APPROVAL"),
    totalAmount: decimal("total_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Put the returned items back into stock (false = damaged/write-off). */
    restock: boolean("restock").notNull().default(true),
    reason: varchar("reason", { length: 500 }).notNull(),
    notes: text("notes"),
    processedBy: bigint("processed_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedReason: varchar("rejected_reason", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_returns_sale").on(t.saleId),
    index("idx_returns_customer").on(t.customerId),
    index("idx_returns_status").on(t.status),
    index("idx_returns_created").on(t.createdAt),
  ],
);

export const salesReturnItems = mysqlTable(
  "sales_return_items",
  {
    id: serial("id").primaryKey(),
    returnId: bigint("return_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => salesReturns.id, { onDelete: "cascade" }),
    saleItemId: bigint("sale_item_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => saleItems.id, { onDelete: "restrict" }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    // Snapshots (kept correct even if the product/sale changes later):
    productName: varchar("product_name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 50 }).notNull(),
    soldAsUnits: boolean("sold_as_units").notNull().default(false),
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    /** Stock restored in PACKS (units ÷ unitsPerPack when soldAsUnits). */
    packsRestored: decimal("packs_restored", { precision: 14, scale: 3, mode: "number" }).notNull(),
    unitPrice: decimal("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
    lineTotal: decimal("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [index("idx_return_items_return").on(t.returnId), index("idx_return_items_product").on(t.productId)],
);

/**
 * Swapping items from a completed sale for different items. Returned items
 * go back into stock at their original sold value; new items leave stock at
 * current selling price. The value difference is settled by settlementType:
 * customer tops up (cash/transfer/POS/cheque/deposit wallet/credit) or, when
 * the new items are cheaper, the difference is credited to the deposit wallet.
 */
export const salesExchanges = mysqlTable(
  "sales_exchanges",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // EXC-000001
    saleId: bigint("sale_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(
      () => customers.id,
      { onDelete: "restrict" },
    ),
    status: mysqlEnum("status", EXCHANGE_STATUSES).notNull().default("PENDING_APPROVAL"),
    returnedTotal: decimal("returned_total", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    newTotal: decimal("new_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** newTotal − returnedTotal. Positive → customer tops up; negative → credit to deposit wallet. */
    difference: decimal("difference", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    settlementType: mysqlEnum("settlement_type", EXCHANGE_SETTLEMENTS).notNull().default("NONE"),
    /** Top-up amount actually collected / drawn / credited (abs of difference when settled). */
    settledAmount: decimal("settled_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    externalReference: varchar("external_reference", { length: 120 }), // bank transfer ref / cheque no for top-ups
    proofUrl: varchar("proof_url", { length: 500 }), // top-up payment proof
    proofPublicId: varchar("proof_public_id", { length: 255 }),
    reason: varchar("reason", { length: 500 }).notNull(),
    notes: text("notes"),
    processedBy: bigint("processed_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedReason: varchar("rejected_reason", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_exchanges_sale").on(t.saleId),
    index("idx_exchanges_customer").on(t.customerId),
    index("idx_exchanges_status").on(t.status),
    index("idx_exchanges_created").on(t.createdAt),
  ],
);

export const salesExchangeItems = mysqlTable(
  "sales_exchange_items",
  {
    id: serial("id").primaryKey(),
    exchangeId: bigint("exchange_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => salesExchanges.id, { onDelete: "cascade" }),
    direction: mysqlEnum("direction", ["RETURNED", "NEW"]).notNull(),
    /** For RETURNED lines — the original sale line; null for NEW lines. */
    saleItemId: bigint("sale_item_id", { mode: "number", unsigned: true }).references(() => saleItems.id, {
      onDelete: "restrict",
    }),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productName: varchar("product_name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 50 }).notNull(),
    soldAsUnits: boolean("sold_as_units").notNull().default(false),
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "number" }).notNull(),
    /** Stock movement in PACKS (restored for RETURNED, deducted for NEW). */
    packsQty: decimal("packs_qty", { precision: 14, scale: 3, mode: "number" }).notNull(),
    unitPrice: decimal("unit_price", { precision: 14, scale: 2, mode: "number" }).notNull(),
    lineTotal: decimal("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_exchange_items_exchange").on(t.exchangeId),
    index("idx_exchange_items_product").on(t.productId),
  ],
);

/* ===================== 8. PAYMENTS (WITH PROOFS) ===================== */

/**
 * Every money-in / money-out event with its proof. Covers sale payments,
 * credit repayments, advance deposits and deposit refunds. Overpayment on
 * a sale is split at confirmation: appliedToSale covers the sale balance,
 * addedToDeposit flows into the customer's deposit wallet.
 */
export const payments = mysqlTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // PAY-000001
    /** Null only for SALE_PAYMENTs against walk-in sales (no customer account). */
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(
      () => customers.id,
      { onDelete: "restrict" },
    ),
    saleId: bigint("sale_id", { mode: "number", unsigned: true }).references(() => sales.id, {
      onDelete: "set null",
    }),
    paymentType: mysqlEnum("payment_type", PAYMENT_TYPES).notNull(),
    method: mysqlEnum("method", PAYMENT_METHODS).notNull(),
    /** Total cash value the customer handed over (or we refunded, negative). */
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    /** How much was applied to the linked sale's balance. */
    appliedToSale: decimal("applied_to_sale", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Overpayment portion routed into the deposit wallet. */
    addedToDeposit: decimal("added_to_deposit", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Payment proof — receipt / transfer screenshot (Cloudinary URL). */
    proofUrl: varchar("proof_url", { length: 500 }),
    proofPublicId: varchar("proof_public_id", { length: 255 }),
    externalReference: varchar("external_reference", { length: 120 }), // bank transfer ref / cheque no
    status: mysqlEnum("status", PAYMENT_STATUSES).notNull().default("PENDING_APPROVAL"),
    notes: text("notes"),
    recordedBy: bigint("recorded_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: bigint("confirmed_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at"),
    rejectedReason: varchar("rejected_reason", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_payments_customer").on(t.customerId),
    index("idx_payments_sale").on(t.saleId),
    index("idx_payments_status").on(t.status),
    index("idx_payments_created").on(t.createdAt),
  ],
);

/* ============================ 9. EXPENSES ============================ */

export const expenseCategories = mysqlTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(), // Transport, Loading, Rent…
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const expenses = mysqlTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // EXP-000001
    categoryId: bigint("category_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    description: text("description").notNull(),
    vendor: varchar("vendor", { length: 160 }),
    /** How the money actually left (cash/bank/pos/cheque). Null on legacy rows = treated as cash. */
    paymentMethod: mysqlEnum("payment_method", MONEY_METHODS),
    expenseDate: date("expense_date").notNull(),
    receiptUrl: varchar("receipt_url", { length: 500 }), // receipt proof
    receiptPublicId: varchar("receipt_public_id", { length: 255 }),
    status: mysqlEnum("status", EXPENSE_STATUSES).notNull().default("PENDING"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedReason: varchar("rejected_reason", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_expenses_status").on(t.status), index("idx_expenses_date").on(t.expenseDate)],
);

/* ===================== 9a. MANUAL MONEY MOVEMENTS ===================== */

/**
 * "Other" money in/out recorded directly on the Money page — anything real
 * that isn't a sale payment, credit repayment, deposit, expense, salary or
 * loan (e.g. owner capital in, bank charges, cash moved to the bank).
 * Only actual cash/bank/pos/cheque money lives here.
 */
export const moneyMovements = mysqlTable(
  "money_movements",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // MM-000001
    direction: mysqlEnum("direction", MONEY_DIRECTIONS).notNull(),
    method: mysqlEnum("method", MONEY_METHODS).notNull(),
    label: varchar("label", { length: 120 }).notNull(), // short category, e.g. "Owner capital"
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    description: text("description"),
    movementDate: date("movement_date").notNull(),
    createdBy: bigint("created_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_money_movements_direction").on(t.direction),
    index("idx_money_movements_date").on(t.movementDate),
  ],
);

/* ===================== 9b. PAYROLL & STAFF LOANS ===================== */

/**
 * Per-staff salary configuration (Admin/Super Admin only).
 * Gross = basic + housing + transport + meal + other allowances + bonus.
 * Deductions = PAYE tax %, pension %, VAT %, other fixed deductions,
 * plus any active loan instalment for the period.
 */
export const salaryConfigs = mysqlTable(
  "salary_configs",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    basicSalary: decimal("basic_salary", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    housingAllowance: decimal("housing_allowance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    transportAllowance: decimal("transport_allowance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    mealAllowance: decimal("meal_allowance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    otherAllowance: decimal("other_allowance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** Standing monthly bonus (extra one-off bonuses can be added per payroll run). */
    monthlyBonus: decimal("monthly_bonus", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** PAYE income tax, % of gross. */
    taxPercent: decimal("tax_percent", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    /** Pension contribution, % of basic. */
    pensionPercent: decimal("pension_percent", { precision: 5, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    /** VAT withholding, % of gross (where applicable). */
    vatPercent: decimal("vat_percent", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    /** Fixed other deductions per month (union dues, welfare…). */
    otherDeduction: decimal("other_deduction", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    deductionNote: varchar("deduction_note", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    effectiveFrom: date("effective_from"),
    notes: text("notes"),
    updatedBy: bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_salary_config_user").on(t.userId)],
);

/**
 * One row per staff per pay period — the full payslip breakdown.
 * When marked PAID a matching company expense is auto-recorded
 * (category "Salaries & Wages") so reports/P&L pick it up.
 */
export const salaryPayments = mysqlTable(
  "salary_payments",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // SAL-202608-0005
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    periodYear: int("period_year").notNull(),
    periodMonth: int("period_month").notNull(), // 1-12
    /* ----- Earnings snapshot ----- */
    basic: decimal("basic", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    housing: decimal("housing", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    transport: decimal("transport", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    meal: decimal("meal", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    otherAllowance: decimal("other_allowance", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    bonus: decimal("bonus", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    bonusNote: varchar("bonus_note", { length: 255 }),
    grossPay: decimal("gross_pay", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /* ----- Deductions snapshot ----- */
    taxAmount: decimal("tax_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    pensionAmount: decimal("pension_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    vatAmount: decimal("vat_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    otherDeduction: decimal("other_deduction", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    loanDeduction: decimal("loan_deduction", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    totalDeductions: decimal("total_deductions", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    netPay: decimal("net_pay", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /* ----- Payment ----- */
    status: mysqlEnum("status", SALARY_PAYMENT_STATUSES).notNull().default("PENDING"),
    paymentMethod: mysqlEnum("payment_method", SALARY_PAYMENT_METHODS),
    paymentReference: varchar("payment_reference", { length: 120 }), // bank transfer ref
    paidAt: timestamp("paid_at"),
    paidBy: bigint("paid_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    /** Auto-created expense row (Salaries & Wages) when paid. */
    expenseId: bigint("expense_id", { mode: "number", unsigned: true }).references(() => expenses.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdBy: bigint("created_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    uniqueIndex("uq_salary_period").on(t.userId, t.periodYear, t.periodMonth),
    index("idx_salary_status").on(t.status),
    index("idx_salary_period").on(t.periodYear, t.periodMonth),
  ],
);

/**
 * A loan the company gives a staff member, repaid by salary deductions
 * over termMonths starting from startPeriod (configured per loan).
 * Disbursement is auto-recorded as a company expense ("Staff Loans").
 */
export const staffLoans = mysqlTable(
  "staff_loans",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 30 }).notNull().unique(), // LN-000001
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    termMonths: int("term_months").notNull(), // e.g. deduct over the next 3 salaries
    monthlyDeduction: decimal("monthly_deduction", { precision: 14, scale: 2, mode: "number" })
      .notNull(),
    amountRepaid: decimal("amount_repaid", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    remainingBalance: decimal("remaining_balance", { precision: 14, scale: 2, mode: "number" })
      .notNull(),
    /** First salary period the deduction comes out of. */
    startYear: int("start_year").notNull(),
    startMonth: int("start_month").notNull(), // 1-12
    status: mysqlEnum("status", LOAN_STATUSES).notNull().default("PENDING"),
    reason: varchar("reason", { length: 500 }).notNull(),
    notes: text("notes"),
    /** Auto-created expense row (Staff Loans) when disbursed. */
    expenseId: bigint("expense_id", { mode: "number", unsigned: true }).references(() => expenses.id, {
      onDelete: "set null",
    }),
    approvedBy: bigint("approved_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedReason: varchar("rejected_reason", { length: 255 }),
    createdBy: bigint("created_by", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index("idx_loans_user").on(t.userId),
    index("idx_loans_status").on(t.status),
  ],
);

/** One row per loan instalment actually deducted (usually from a salary payment). */
export const staffLoanRepayments = mysqlTable(
  "staff_loan_repayments",
  {
    id: serial("id").primaryKey(),
    loanId: bigint("loan_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => staffLoans.id, { onDelete: "cascade" }),
    salaryPaymentId: bigint("salary_payment_id", { mode: "number", unsigned: true }).references(
      () => salaryPayments.id,
      { onDelete: "set null" },
    ),
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    periodYear: int("period_year").notNull(),
    periodMonth: int("period_month").notNull(),
    note: varchar("note", { length: 255 }),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_loan_repayments_loan").on(t.loanId)],
);

/* ================= 10. CONFIGURABLE APPROVAL WORKFLOWS ================= */

/**
 * Approval chains per entity type, set by Admin/Super Admin.
 * steps = ordered roles that must sign off, e.g. ["MANAGER"] or
 * ["MANAGER","ADMIN"] — sales → manager → admin as final.
 */
export const approvalFlows = mysqlTable(
  "approval_flows",
  {
    id: serial("id").primaryKey(),
    entityType: mysqlEnum("entity_type", APPROVAL_FLOW_ENTITIES).notNull().unique(),
    steps: json("steps").$type<string[]>().notNull(), // ordered UserRole list
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
);

/** A live request moving through its chain. */
export const approvalRequests = mysqlTable(
  "approval_requests",
  {
    id: serial("id").primaryKey(),
    requestType: mysqlEnum("request_type", APPROVAL_TYPES).notNull(),
    status: mysqlEnum("status", APPROVAL_REQUEST_STATUSES).notNull().default("PENDING"),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // SALE | PAYMENT | EXPENSE | PRODUCT…
    entityId: bigint("entity_id", { mode: "number", unsigned: true }),
    /** Full before/after payload reviewers inspect; system applies on final approval. */
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    totalSteps: int("total_steps").notNull().default(1),
    currentStep: int("current_step").notNull().default(1),
    requesterId: bigint("requester_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("idx_approvals_status").on(t.status),
    index("idx_approvals_requester").on(t.requesterId),
    index("idx_approvals_entity").on(t.entityType, t.entityId),
  ],
);

/** One row per step of the chain — who must act, and what they decided. */
export const approvalRequestSteps = mysqlTable(
  "approval_request_steps",
  {
    id: serial("id").primaryKey(),
    requestId: bigint("request_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepOrder: int("step_order").notNull(), // 1-based, matches approvalFlows.steps
    role: mysqlEnum("role", USER_ROLES).notNull(), // role that must review this step
    status: mysqlEnum("status", APPROVAL_STEP_STATUSES).notNull().default("WAITING"),
    reviewerId: bigint("reviewer_id", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    reviewNote: text("review_note"),
    actedAt: timestamp("acted_at"),
  },
  (t) => [
    uniqueIndex("uq_request_step").on(t.requestId, t.stepOrder),
    index("idx_steps_role_status").on(t.role, t.status),
  ],
);

/* ============================ 11. TEAM CHAT ============================ */

export const chatConversations = mysqlTable("chat_conversations", {
  id: serial("id").primaryKey(),
  type: mysqlEnum("type", CONVERSATION_TYPES).notNull().default("DIRECT"),
  name: varchar("name", { length: 160 }), // group chats only
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chatParticipants = mysqlTable(
  "chat_participants",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadMessageId: bigint("last_read_message_id", { mode: "number", unsigned: true }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_conversation_user").on(t.conversationId, t.userId),
    index("idx_participants_user").on(t.userId),
  ],
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    senderId: bigint("sender_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body"),
    attachmentUrl: varchar("attachment_url", { length: 500 }),
    attachmentType: mysqlEnum("attachment_type", ATTACHMENT_TYPES),
    attachmentName: varchar("attachment_name", { length: 255 }),
    /** Reference cards (product / sale / customer / payment…) with deep links into the app. */
    referenceType: mysqlEnum("reference_type", MESSAGE_REFERENCE_TYPES),
    referenceId: bigint("reference_id", { mode: "number", unsigned: true }),
    referenceLabel: varchar("reference_label", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_messages_conversation").on(t.conversationId),
    index("idx_messages_created").on(t.createdAt),
  ],
);

/* ============================ 12. AI ASSISTANT ============================ */

export const aiConversations = mysqlTable(
  "ai_conversations",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("New conversation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("idx_ai_conversations_user").on(t.userId)],
);

export const aiMessages = mysqlTable(
  "ai_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", AI_MESSAGE_ROLES).notNull(),
    content: text("content").notNull(),
    tokenCount: int("token_count"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_ai_messages_conversation").on(t.conversationId)],
);

/* ===================== 13. SETTINGS & NOTIFICATIONS ===================== */

/** Key-value store: company profile, currency, workflow toggles, receipt config, Cloudinary keys… */
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(), // e.g. business.name, sales.currency
  value: text("value").notNull(), // JSON-encoded
  group: varchar("group", { length: 50 }).notNull().default("SYSTEM"),
  description: varchar("description", { length: 255 }),
  updatedBy: bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const notifications = mysqlTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(), // APPROVAL | LOW_STOCK | PAYMENT | SYSTEM | CHAT
    title: varchar("title", { length: 200 }).notNull(),
    body: varchar("body", { length: 500 }),
    link: varchar("link", { length: 300 }),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_notifications_user").on(t.userId, t.isRead)],
);

/* ============================ 14. AUDIT LOG ============================ */

/** Every sensitive action lands here — who, what, before → after, when, from where. */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: bigint("actor_id", { mode: "number", unsigned: true }).references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: varchar("actor_name", { length: 160 }).notNull(), // snapshot
    actorRole: varchar("actor_role", { length: 20 }).notNull(),
    action: varchar("action", { length: 60 }).notNull(), // e.g. sale.create, payment.confirm, settings.update
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 40 }),
    description: varchar("description", { length: 500 }).notNull(),
    beforeData: json("before_data").$type<Record<string, unknown> | null>(),
    afterData: json("after_data").$type<Record<string, unknown> | null>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_actor").on(t.actorId),
    index("idx_audit_action").on(t.action),
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_created").on(t.createdAt),
  ],
);

/* ============================ Inferred types ============================ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type UserPermission = typeof userPermissions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type PriceList = typeof priceLists.$inferSelect;
export type PriceListItem = typeof priceListItems.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type StockCount = typeof stockCounts.$inferSelect;
export type StockCountItem = typeof stockCountItems.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerTransaction = typeof customerTransactions.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type SalesReturn = typeof salesReturns.$inferSelect;
export type SalesReturnItem = typeof salesReturnItems.$inferSelect;
export type SalesExchange = typeof salesExchanges.$inferSelect;
export type SalesExchangeItem = typeof salesExchangeItems.$inferSelect;
export type SalaryConfig = typeof salaryConfigs.$inferSelect;
export type SalaryPayment = typeof salaryPayments.$inferSelect;
export type StaffLoan = typeof staffLoans.$inferSelect;
export type StaffLoanRepayment = typeof staffLoanRepayments.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type MoneyMovement = typeof moneyMovements.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ApprovalFlow = typeof approvalFlows.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type ApprovalRequestStep = typeof approvalRequestSteps.$inferSelect;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
