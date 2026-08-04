/**
 * YABUZ OIL & GAS — Shared enum constants (frontend ↔ backend)
 * Keep these as `as const` tuples: db/schema.ts and zod both consume them.
 */

export const USER_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE", "DISCONTINUED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** How a product is packed/sold: carton of gallons, keg, drum, rubber, cups… */
export const PACK_TYPES = ["CARTON", "KEG", "DRUM", "RUBBER", "CUP", "UNIT"] as const;
export type PackType = (typeof PACK_TYPES)[number];

/** Generic approval gate stamped on entities created/edited by lower roles. */
export const APPROVAL_STATUSES = ["NONE", "PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/* ------------------------------ SALES ------------------------------ */
export const SALE_STATUSES = [
  "DRAFT",
  "ON_HOLD",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID", "OVERPAID"] as const;
export type SalePaymentStatus = (typeof SALE_PAYMENT_STATUSES)[number];

/* ------------------------------ PAYMENTS ------------------------------ */
export const PAYMENT_TYPES = [
  "SALE_PAYMENT",     // payment against a specific sale
  "CREDIT_PAYMENT",   // payment against outstanding credit balance
  "ADVANCE_DEPOSIT",  // money deposited with us upfront
  "DEPOSIT_REFUND",   // we return deposit money to the customer
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "POS",
  "CHEQUE",
  "DEPOSIT_BALANCE", // customer pays from their advance deposit wallet
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING_APPROVAL", "CONFIRMED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* ------------------------------ CUSTOMER LEDGER ------------------------------ */
export const CUSTOMER_TRANSACTION_TYPES = [
  "SALE_DEBIT",      // sale on credit → outstanding up
  "PAYMENT_CREDIT",  // payment received → outstanding down
  "DEPOSIT_IN",      // advance deposit received (incl. overpayments)
  "DEPOSIT_USED",    // deposit balance used to pay a sale
  "DEPOSIT_REFUND",  // deposit paid back out to customer
  "ADJUSTMENT",      // manual correction (audit-logged)
] as const;
export type CustomerTransactionType = (typeof CUSTOMER_TRANSACTION_TYPES)[number];

/* ------------------------------ INVENTORY ------------------------------ */
export const STOCK_MOVEMENT_TYPES = [
  "SUPPLY_IN",       // supply received from producer (Polar)
  "PURCHASE_IN",     // purchase order receipt
  "SALE_OUT",        // stock out through an approved sale
  "RETURN_IN",       // customer return back into stock
  "EXCHANGE_OUT",    // new items leaving stock through an exchange
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "COUNT_ADJUST",    // variance applied after a stock count
  "DAMAGE_OUT",      // damaged/leaked stock written off
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_COUNT_STATUSES = ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export const PURCHASE_STATUSES = ["PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/* ------------------------- RETURNS & EXCHANGES ------------------------- */
/** Returns/exchanges ride the approval chain, then complete. */
export const RETURN_STATUSES = ["PENDING_APPROVAL", "COMPLETED", "REJECTED", "CANCELLED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const EXCHANGE_STATUSES = ["PENDING_APPROVAL", "COMPLETED", "REJECTED", "CANCELLED"] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

/** How the money difference on an exchange is settled. */
export const EXCHANGE_SETTLEMENTS = [
  "NONE",            // returned value == new items value
  "TOPUP_CASH",      // customer tops up by cash
  "TOPUP_TRANSFER",  // customer tops up by bank transfer
  "TOPUP_POS",       // customer tops up by POS
  "TOPUP_CHEQUE",    // customer tops up by cheque
  "TOPUP_DEPOSIT",   // difference drawn from the customer's deposit wallet
  "TOPUP_CREDIT",    // difference added to the customer's outstanding credit
  "TO_DEPOSIT",      // new items cost LESS — difference credited to the deposit wallet
] as const;
export type ExchangeSettlement = (typeof EXCHANGE_SETTLEMENTS)[number];

/* ------------------------- PAYROLL & STAFF LOANS ------------------------- */
export const SALARY_PAYMENT_STATUSES = ["PENDING", "PAID", "CANCELLED"] as const;
export type SalaryPaymentStatus = (typeof SALARY_PAYMENT_STATUSES)[number];

export const SALARY_PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "CHEQUE"] as const;
export type SalaryPaymentMethod = (typeof SALARY_PAYMENT_METHODS)[number];

export const LOAN_STATUSES = ["PENDING", "ACTIVE", "PAID_OFF", "REJECTED", "CANCELLED"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/* ------------------------------ EXPENSES ------------------------------ */
export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/* ------------------------------ APPROVAL WORKFLOW ------------------------------ */
/** Entities that can carry a configurable approval chain. */
export const APPROVAL_FLOW_ENTITIES = [
  "SALE",
  "PAYMENT",
  "DEPOSIT",
  "EXPENSE",
  "PRODUCT",
  "PRICE_LIST",
  "STOCK_ADJUSTMENT",
  "STOCK_COUNT",
  "PURCHASE_ORDER",
  "CUSTOMER_CREDIT",
  "SALE_RETURN",
  "SALE_EXCHANGE",
] as const;
export type ApprovalFlowEntity = (typeof APPROVAL_FLOW_ENTITIES)[number];

export const APPROVAL_TYPES = [
  "SALE_CREATE",
  "SALE_CANCEL",
  "PAYMENT_RECORD",
  "DEPOSIT_RECORD",
  "DEPOSIT_REFUND",
  "EXPENSE_CREATE",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "PRODUCT_DELETE",
  "PRICE_LIST_PUBLISH",
  "STOCK_ADJUSTMENT",
  "STOCK_COUNT_APPLY",
  "PURCHASE_ORDER",
  "CUSTOMER_CREDIT_LIMIT",
  "SALE_RETURN_CREATE",
  "SALE_EXCHANGE_CREATE",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_STEP_STATUSES = ["WAITING", "PENDING", "APPROVED", "REJECTED", "SKIPPED"] as const;
export type ApprovalStepStatus = (typeof APPROVAL_STEP_STATUSES)[number];

/* ------------------------------ CUSTOMERS ------------------------------ */
export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Individual buyer vs registered business. */
export const CUSTOMER_TYPES = ["INDIVIDUAL", "BUSINESS"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/* ------------------------------ CHAT & AI ------------------------------ */
export const CONVERSATION_TYPES = ["DIRECT", "GROUP"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const MESSAGE_REFERENCE_TYPES = [
  "PRODUCT",
  "SALE",
  "CUSTOMER",
  "PAYMENT",
  "PURCHASE",
  "STOCK",
  "EXPENSE",
] as const;
export type MessageReferenceType = (typeof MESSAGE_REFERENCE_TYPES)[number];

export const ATTACHMENT_TYPES = ["IMAGE", "DOCUMENT", "AUDIO", "OTHER"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const AI_MESSAGE_ROLES = ["USER", "ASSISTANT", "SYSTEM"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];
