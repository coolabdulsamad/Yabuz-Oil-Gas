import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  customers,
  expenseCategories,
  expenses,
  payments,
  products,
  saleItems,
  sales,
  settings,
  users,
} from "@db/schema";
import type { MessageReferenceType } from "@contracts/constants";
import type { UserRole } from "@contracts/roles";

/**
 * YABUZ OIL & GAS — AI assistant brain.
 *
 * Two layers:
 *  1. DETERMINISTIC DATA ENGINE (always on) — parses the question, runs live
 *     queries against products / sales / customers / inventory / payments /
 *     expenses, and composes a precise answer with entity references.
 *     Every figure comes straight from the database — nothing is invented.
 *  2. OPTIONAL LLM POLISH — when an OpenAI-compatible key is configured in
 *     Settings → Integrations (ai.api_key), the retrieved facts are handed to
 *     the model for a more natural reply. Any failure falls back silently to
 *     the deterministic answer.
 *
 * Permission-aware: the engine only surfaces data the asking user is allowed
 * to see (e.g. sales reps never get cost prices or margins).
 */

export interface EntityRef {
  type: MessageReferenceType;
  id: number;
  label: string;
}

export interface AiAnswer {
  answer: string;
  references: EntityRef[];
  /** Raw computed facts — also fed to the LLM when configured. */
  facts: string;
}

export interface AiUserContext {
  id: number;
  fullName: string;
  role: UserRole;
  permissions: Set<string>;
}

/* ------------------------------ formatting ------------------------------ */

const NGN = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
const money = (n: number) => `₦${NGN.format(Math.round(n))}`;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/* ------------------------------ period parsing ------------------------------ */

interface Period {
  from: Date; // inclusive
  to: Date; // exclusive
  label: string;
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function periodFromQuestion(q: string): Period {
  const now = new Date();
  const today = utcDayStart(now);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (/\byesterday\b/.test(q)) {
    const y = new Date(today);
    y.setUTCDate(y.getUTCDate() - 1);
    return { from: y, to: today, label: "yesterday" };
  }
  if (/\b(this|current)\s+week\b/.test(q)) {
    const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
    const mon = new Date(today);
    mon.setUTCDate(mon.getUTCDate() - dow);
    return { from: mon, to: tomorrow, label: "this week" };
  }
  if (/\blast\s+week\b/.test(q)) {
    const dow = (today.getUTCDay() + 6) % 7;
    const mon = new Date(today);
    mon.setUTCDate(mon.getUTCDate() - dow - 7);
    const sun = new Date(mon);
    sun.setUTCDate(sun.getUTCDate() + 7);
    return { from: mon, to: sun, label: "last week" };
  }
  if (/\b(this|current)\s+month\b/.test(q)) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: first, to: tomorrow, label: "this month" };
  }
  if (/\blast\s+month\b/.test(q)) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { from: first, to: end, label: "last month" };
  }
  if (/\ball\s*time\b|\bever\b|\boverall\b/.test(q)) {
    return { from: new Date(Date.UTC(2020, 0, 1)), to: tomorrow, label: "all time" };
  }
  return { from: today, to: tomorrow, label: "today" };
}

/* ------------------------------ entity matching ------------------------------ */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "how", "much", "many", "what", "whats", "is", "are",
  "do", "does", "did", "we", "i", "me", "my", "our", "us", "have", "has", "left",
  "in", "on", "at", "to", "and", "or", "any", "some", "tell", "show", "give", "get",
  "stock", "stocks", "inventory", "price", "prices", "cost", "sale", "sales", "sell",
  "sold", "customer", "customers", "product", "products", "balance", "owe", "owes",
  "owed", "owing", "debt", "debts", "deposit", "deposits", "credit", "payment",
  "payments", "check", "please", "now", "currently", "remaining", "available", "level",
  "levels", "quantity", "packs", "pack", "cartons", "carton", "drums", "drum", "kegs",
  "keg", "gallons", "gallon", "total", "today", "yesterday", "this", "last", "week",
  "month", "all", "time", "best", "top", "selling", "who", "which", "their", "his",
  "her", "them", "with", "from", "against", "does", "company", "business", "report",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

interface ProductHit {
  p: typeof products.$inferSelect;
  score: number;
}

function matchProducts(q: string, all: (typeof products.$inferSelect)[]): ProductHit[] {
  const qTokens = tokens(q);
  if (qTokens.length === 0) return [];
  const hits: ProductHit[] = [];
  for (const p of all) {
    const name = p.name.toLowerCase();
    const sku = p.sku.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (sku === t || sku.startsWith(t)) score += 3;
      else if (name.includes(t)) score += t.length >= 4 ? 2 : 1;
    }
    // exact-phrase bonus ("alva 5000", "rolam x", "elite 4lts")
    const phrase = qTokens.join(" ");
    if (phrase.length >= 5 && name.includes(phrase)) score += 6;
    if (score > 0) hits.push({ p, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 4);
}

interface CustomerHit {
  c: typeof customers.$inferSelect;
  score: number;
}

function matchCustomers(q: string, all: (typeof customers.$inferSelect)[]): CustomerHit[] {
  const qTokens = tokens(q);
  if (qTokens.length === 0) return [];
  const hits: CustomerHit[] = [];
  for (const c of all) {
    const name = `${c.fullName} ${c.businessName ?? ""}`.toLowerCase();
    const code = c.code.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (code === t) score += 5;
      else if (name.includes(t)) score += t.length >= 4 ? 3 : 1;
    }
    if (score > 0) hits.push({ c, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 4);
}

/* ------------------------------ fact helpers ------------------------------ */

async function salesSummary(period: Period, repId: number | null) {
  const db = getDb();
  const conds = [gte(sales.createdAt, period.from), lte(sales.createdAt, period.to), eq(sales.status, "COMPLETED" as const)];
  if (repId !== null) conds.push(eq(sales.salesRepId, repId));
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      revenue: sql<string>`COALESCE(SUM(${sales.grandTotal}), 0)`,
      collected: sql<string>`COALESCE(SUM(${sales.amountPaid}), 0)`,
      outstanding: sql<string>`COALESCE(SUM(GREATEST(${sales.balanceDue}, 0)), 0)`,
    })
    .from(sales)
    .where(and(...conds));
  return {
    count: Number(row?.count ?? 0),
    revenue: Number(row?.revenue ?? 0),
    collected: Number(row?.collected ?? 0),
    outstanding: Number(row?.outstanding ?? 0),
  };
}

/* ------------------------------ main entry ------------------------------ */

export async function answerBusinessQuestion(question: string, user: AiUserContext): Promise<AiAnswer> {
  const db = getDb();
  const q = question.toLowerCase().trim();
  const refs: EntityRef[] = [];
  const perms = user.permissions;
  const can = (key: string) => perms.has(key);

  /* ----- small talk (greetings, thanks, farewells, help) ----- */
  const firstName = user.fullName.split(" ")[0] ?? user.fullName;
  const smallTalk = smallTalkAnswer(q, firstName, can);
  if (smallTalk) {
    return { answer: smallTalk, references: refs, facts: `The user (${user.fullName}) is making small talk, not asking for data. Greet them back warmly and briefly mention what you can do.` };
  }

  /* ----- direct sale lookup by order number ----- */
  const orderMatch = q.match(/so-\d{6,}-\d+/i);
  if (orderMatch && can("sales.view")) {
    const orderNo = orderMatch[0].toUpperCase();
    const sale = (
      await db.select().from(sales).where(eq(sales.orderNo, orderNo)).limit(1)
    )[0];
    if (sale) {
      if (!can("sales.view_all") && sale.salesRepId !== user.id) {
        return deny("details of other staff's sales", refs);
      }
      const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
      const cust = sale.customerId
        ? (await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1))[0]
        : null;
      const rep = (await db.select().from(users).where(eq(users.id, sale.salesRepId)).limit(1))[0];
      refs.push({ type: "SALE", id: sale.id, label: sale.orderNo });
      if (cust) refs.push({ type: "CUSTOMER", id: cust.id, label: cust.fullName });
      const lines = items.map(
        (it) => `- ${qty(Number(it.packsDeducted))} × ${it.productName} @ ${money(Number(it.unitPrice))} = ${money(Number(it.lineTotal))}`,
      );
      const facts = [
        `Sale ${sale.orderNo}: status ${sale.status}, payment ${sale.paymentStatus}.`,
        `Customer: ${cust?.fullName ?? "Walk-in"}. Rep: ${rep?.fullName ?? "?"}.`,
        `Total ${money(Number(sale.grandTotal))}, paid ${money(Number(sale.amountPaid))}, balance ${money(Number(sale.balanceDue))}.`,
        ...lines,
      ].join("\n");
      const answer = [
        `**Sale ${sale.orderNo}** — ${sale.status.replace(/_/g, " ")}, payment ${sale.paymentStatus}.`,
        `- Customer: **${cust?.fullName ?? "Walk-in customer"}**`,
        `- Handled by: ${rep?.fullName ?? "unknown"}`,
        `- Total: **${money(Number(sale.grandTotal))}** · Paid: ${money(Number(sale.amountPaid))} · Balance: ${money(Number(sale.balanceDue))}`,
        ``,
        `Items:`,
        ...lines,
      ].join("\n");
      return { answer, references: refs, facts };
    }
    return {
      answer: `I couldn't find any sale with order number **${orderNo}**. Check the number and try again.`,
      references: refs,
      facts: `No sale found for order ${orderNo}.`,
    };
  }

  /* ----- load small reference tables once ----- */
  const allProducts = can("products.view") || can("inventory.view")
    ? await db.select().from(products).where(or(eq(products.status, "ACTIVE"), eq(products.status, "INACTIVE")))
    : [];
  const allCustomers = can("customers.view")
    ? await db.select().from(customers).where(eq(customers.status, "ACTIVE"))
    : [];

  const productHits = matchProducts(q, allProducts);
  const customerHits = matchCustomers(q, allCustomers);

  const asksStock = /\b(stock|stocks|inventory|left|remaining|available|quantity|how many)\b/.test(q);
  const asksPriceWord = /\b(price|prices|cost|selling|sell at)\b/.test(q);
  const asksHowMuch = /\bhow much\b/.test(q);
  const asksOwe = /\b(owe|owes|owed|owing|debt|outstanding|credit|balance)\b/.test(q);
  const asksDeposit = /\b(deposit|deposits|advance|wallet)\b/.test(q);

  /* ----- product stock ----- */
  if (productHits.length > 0 && asksStock && !asksPriceWord && can("inventory.view")) {
    const lines: string[] = [];
    for (const { p } of productHits.slice(0, 3)) {
      refs.push({ type: "PRODUCT", id: p.id, label: p.name });
      const stock = Number(p.currentStock);
      const low = stock <= Number(p.reorderLevel);
      lines.push(
        `- **${p.name}**: **${qty(stock)} ${p.packType.toLowerCase()}${stock === 1 ? "" : "s"}** in stock` +
          (low ? ` ⚠️ (at/below reorder level of ${qty(Number(p.reorderLevel))})` : "") +
          ` — worth ${money(stock * Number(p.sellCartonPrice))} at selling price`,
      );
    }
    const facts = productHits
      .slice(0, 3)
      .map(({ p }) => `${p.name}: ${qty(Number(p.currentStock))} packs in stock, reorder level ${qty(Number(p.reorderLevel))}.`)
      .join("\n");
    return {
      answer: [`Here's the current stock position:`, ...lines].join("\n"),
      references: refs,
      facts,
    };
  }

  /* ----- product price ----- */
  if (
    productHits.length > 0 &&
    (asksPriceWord || (asksHowMuch && !asksStock && !asksOwe && customerHits.length === 0)) &&
    can("products.view")
  ) {
    const showCost = can("prices.view_cost");
    const lines: string[] = [];
    for (const { p } of productHits.slice(0, 3)) {
      refs.push({ type: "PRODUCT", id: p.id, label: p.name });
      let line = `- **${p.name}**: **${money(Number(p.sellCartonPrice))}** per ${p.packType.toLowerCase()}`;
      if (Number(p.unitsPerPack) > 1 && p.allowUnitSales) {
        line += ` (${money(Number(p.sellUnitPrice))} per ${p.unitLabel.toLowerCase()})`;
      }
      if (showCost) {
        const margin = Number(p.sellCartonPrice) - Number(p.costCartonPrice);
        line += ` — cost ${money(Number(p.costCartonPrice))}, margin ${money(margin)}`;
      }
      lines.push(line);
    }
    const facts = productHits
      .slice(0, 3)
      .map(({ p }) => `${p.name}: sells at ${money(Number(p.sellCartonPrice))} per pack${showCost ? `, cost ${money(Number(p.costCartonPrice))}` : ""}.`)
      .join("\n");
    return { answer: [`Current selling prices:`, ...lines].join("\n"), references: refs, facts };
  }

  /* ----- low stock ----- */
  if (/\b(low[ -]stock|low on stock|running (out|low)|out of stock|reorder|restock|shortage)\b/.test(q) && can("inventory.view")) {
    const lowRows = allProducts
      .filter((p) => Number(p.currentStock) <= Number(p.reorderLevel))
      .sort((a, b) => Number(a.currentStock) - Number(b.currentStock))
      .slice(0, 10);
    if (lowRows.length === 0) {
      return {
        answer: `Good news — no product is at or below its reorder level right now.`,
        references: refs,
        facts: "No products below reorder level.",
      };
    }
    const lines = lowRows.map((p) => {
      refs.push({ type: "PRODUCT", id: p.id, label: p.name });
      return `- **${p.name}**: ${qty(Number(p.currentStock))} left (reorder at ${qty(Number(p.reorderLevel))})`;
    });
    const facts = lowRows.map((p) => `${p.name}: ${qty(Number(p.currentStock))} left.`).join("\n");
    return {
      answer: [
        `**${lowRows.length} product${lowRows.length === 1 ? "" : "s"}** at or below reorder level:`,
        ...lines,
        ``,
        `Consider raising a purchase order to Polar for these.`,
      ].join("\n"),
      references: refs,
      facts,
    };
  }

  /* ----- customer balance / debt ----- */
  if (customerHits.length > 0 && (asksOwe || asksDeposit) && can("customers.view")) {
    const lines: string[] = [];
    for (const { c } of customerHits.slice(0, 3)) {
      refs.push({ type: "CUSTOMER", id: c.id, label: c.fullName });
      const parts: string[] = [];
      if (asksOwe) {
        parts.push(
          Number(c.creditOutstanding) > 0
            ? `owes **${money(Number(c.creditOutstanding))}**`
            : `owes nothing`,
        );
        if (Number(c.creditLimit) > 0) {
          parts.push(`credit limit ${money(Number(c.creditLimit))} (headroom ${money(Math.max(Number(c.creditLimit) - Number(c.creditOutstanding), 0))})`);
        }
      }
      if (asksDeposit) {
        parts.push(
          Number(c.depositBalance) > 0
            ? `holds **${money(Number(c.depositBalance))}** in advance deposit`
            : `has no deposit balance`,
        );
      }
      lines.push(`- **${c.fullName}** (${c.code}): ${parts.join("; ")}`);
    }
    const facts = customerHits
      .slice(0, 3)
      .map(({ c }) => `${c.fullName}: outstanding ${money(Number(c.creditOutstanding))}, deposit ${money(Number(c.depositBalance))}, limit ${money(Number(c.creditLimit))}.`)
      .join("\n");
    return { answer: lines.join("\n"), references: refs, facts };
  }

  /* ----- who owes us ----- */
  if (/\b(who owes|debtors|owing us|unpaid|receivable)\b/.test(q) && can("credit.view")) {
    const debtors = allCustomers
      .filter((c) => Number(c.creditOutstanding) > 0)
      .sort((a, b) => Number(b.creditOutstanding) - Number(a.creditOutstanding))
      .slice(0, 8);
    if (debtors.length === 0) {
      return {
        answer: `Nobody owes the company right now — all credit balances are clear. 🎉`,
        references: refs,
        facts: "No outstanding customer credit.",
      };
    }
    const total = debtors.reduce((s, c) => s + Number(c.creditOutstanding), 0);
    const lines = debtors.map((c) => {
      refs.push({ type: "CUSTOMER", id: c.id, label: c.fullName });
      return `- **${c.fullName}**: ${money(Number(c.creditOutstanding))}`;
    });
    return {
      answer: [
        `**${debtors.length} customer${debtors.length === 1 ? "" : "s"}** ${debtors.length === 1 ? "owes" : "owe"} a combined **${money(total)}**:`,
        ...lines,
      ].join("\n"),
      references: refs,
      facts: `Total receivables ${money(total)} across ${debtors.length} customers.`,
    };
  }

  /* ----- deposits held ----- */
  if (asksDeposit && /\b(how much|total|held|holding|all|company)\b/.test(q) && can("deposits.view")) {
    const holders = allCustomers
      .filter((c) => Number(c.depositBalance) > 0)
      .sort((a, b) => Number(b.depositBalance) - Number(a.depositBalance));
    const total = holders.reduce((s, c) => s + Number(c.depositBalance), 0);
    if (holders.length === 0) {
      return {
        answer: `No customer is holding an advance deposit with us at the moment.`,
        references: refs,
        facts: "No deposit balances.",
      };
    }
    const lines = holders.slice(0, 8).map((c) => {
      refs.push({ type: "CUSTOMER", id: c.id, label: c.fullName });
      return `- **${c.fullName}**: ${money(Number(c.depositBalance))}`;
    });
    return {
      answer: [
        `We're holding **${money(total)}** in advance deposits for **${holders.length}** customer${holders.length === 1 ? "" : "s"}:`,
        ...lines,
      ].join("\n"),
      references: refs,
      facts: `Total deposits held ${money(total)} for ${holders.length} customers.`,
    };
  }

  /* ----- best sellers ----- */
  if (/\b(top|best|most sold|best.?sell|fast.?mov|highest)\b/.test(q) && can("sales.view")) {
    const period = periodFromQuestion(q);
    const repId = can("sales.view_all") ? null : user.id;
    const conds = [gte(sales.createdAt, period.from), lte(sales.createdAt, period.to), eq(sales.status, "COMPLETED" as const)];
    if (repId !== null) conds.push(eq(sales.salesRepId, repId));
    const rows = await db
      .select({
        productId: saleItems.productId,
        productName: saleItems.productName,
        packs: sql<string>`COALESCE(SUM(${saleItems.packsDeducted}), 0)`,
        revenue: sql<string>`COALESCE(SUM(${saleItems.lineTotal}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(and(...conds))
      .groupBy(saleItems.productId, saleItems.productName)
      .orderBy(desc(sql`SUM(${saleItems.lineTotal})`))
      .limit(5);
    if (rows.length === 0) {
      return {
        answer: `No completed sales ${period.label} yet, so there are no best sellers for that period. Try "best sellers this month" or "all time".`,
        references: refs,
        facts: `No sales ${period.label}.`,
      };
    }
    const lines = rows.map((r, i) => {
      refs.push({ type: "PRODUCT", id: r.productId, label: r.productName });
      return `${i + 1}. **${r.productName}** — ${qty(Number(r.packs))} packs, ${money(Number(r.revenue))}`;
    });
    return {
      answer: [`**Top products ${period.label}** by revenue:`, ...lines].join("\n"),
      references: refs,
      facts: rows.map((r) => `${r.productName}: ${qty(Number(r.packs))} packs, ${money(Number(r.revenue))}.`).join("\n"),
    };
  }

  /* ----- profit / margin ----- */
  if (/\b(profit|margin|margins|earning|earnings|income)\b/.test(q)) {
    if (!can("prices.view_cost")) return deny("profit and margin figures", refs);
    const period = periodFromQuestion(q);
    const summary = await salesSummary(period, can("sales.view_all") ? null : user.id);
    const cogsRow = (
      await db
        .select({ cogs: sql<string>`COALESCE(SUM(${saleItems.packsDeducted} * ${saleItems.costPrice}), 0)` })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(gte(sales.createdAt, period.from), lte(sales.createdAt, period.to), eq(sales.status, "COMPLETED" as const)))
    )[0];
    const expRow = (
      await db
        .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
        .from(expenses)
        .where(and(gte(expenses.expenseDate, period.from), lte(expenses.expenseDate, period.to), eq(expenses.status, "APPROVED" as const)))
    )[0];
    const cogs = Number(cogsRow?.cogs ?? 0);
    const expTotal = Number(expRow?.total ?? 0);
    const gross = summary.revenue - cogs;
    const net = gross - expTotal;
    const facts = `${period.label}: revenue ${money(summary.revenue)}, COGS ${money(cogs)}, gross ${money(gross)}, expenses ${money(expTotal)}, net ${money(net)}.`;
    return {
      answer: [
        `**Profit picture ${period.label}:**`,
        `- Revenue: **${money(summary.revenue)}** (${summary.count} sale${summary.count === 1 ? "" : "s"})`,
        `- Cost of goods sold: ${money(cogs)}`,
        `- Gross margin: **${money(gross)}**${summary.revenue > 0 ? ` (${((gross / summary.revenue) * 100).toFixed(1)}%)` : ""}`,
        `- Operating expenses: ${money(expTotal)}`,
        `- Net margin: **${money(net)}**${summary.revenue > 0 ? ` (${((net / summary.revenue) * 100).toFixed(1)}%)` : ""}`,
      ].join("\n"),
      references: refs,
      facts,
    };
  }

  /* ----- expenses ----- */
  if (/\b(expense|expenses|spend|spent|spending)\b/.test(q) && can("expenses.view")) {
    const period = periodFromQuestion(q);
    const rows = await db
      .select({
        category: expenseCategories.name,
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .where(and(gte(expenses.expenseDate, period.from), lte(expenses.expenseDate, period.to), eq(expenses.status, "APPROVED" as const)))
      .groupBy(expenseCategories.name)
      .orderBy(desc(sql`SUM(${expenses.amount})`));
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    const count = rows.reduce((s, r) => s + Number(r.cnt), 0);
    if (rows.length === 0) {
      return {
        answer: `No approved expenses recorded ${period.label}.`,
        references: refs,
        facts: `No expenses ${period.label}.`,
      };
    }
    const lines = rows.map((r) => `- **${r.category}**: ${money(Number(r.total))} (${r.cnt})`);
    return {
      answer: [
        `**${money(total)}** spent ${period.label} across ${count} approved expense${count === 1 ? "" : "s"}:`,
        ...lines,
      ].join("\n"),
      references: refs,
      facts: `Expenses ${period.label}: total ${money(total)}. ` + rows.map((r) => `${r.category} ${money(Number(r.total))}`).join(", "),
    };
  }

  /* ----- payments / collections ----- */
  if (/\b(payment|payments|collected|collection|received|cash in|money in)\b/.test(q) && can("payments.view")) {
    const period = periodFromQuestion(q);
    const conds = [gte(payments.confirmedAt, period.from), lte(payments.confirmedAt, period.to), eq(payments.status, "CONFIRMED" as const)];
    if (!can("payments.view_all")) conds.push(eq(payments.recordedBy, user.id));
    const rows = await db
      .select({
        type: payments.paymentType,
        total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(payments)
      .where(and(...conds))
      .groupBy(payments.paymentType);
    const moneyIn = rows.filter((r) => r.type !== "DEPOSIT_REFUND").reduce((s, r) => s + Number(r.total), 0);
    const refunds = rows.filter((r) => r.type === "DEPOSIT_REFUND").reduce((s, r) => s + Number(r.total), 0);
    const count = rows.reduce((s, r) => s + Number(r.cnt), 0);
    const labels: Record<string, string> = {
      SALE_PAYMENT: "Sale payments",
      CREDIT_PAYMENT: "Credit repayments",
      ADVANCE_DEPOSIT: "Advance deposits",
      DEPOSIT_REFUND: "Deposit refunds",
    };
    const lines = rows.map((r) => `- **${labels[r.type] ?? r.type}**: ${money(Number(r.total))} (${r.cnt})`);
    return {
      answer: [
        count === 0
          ? `No confirmed payments ${period.label}.`
          : `**${money(moneyIn)}** collected ${period.label} (${count} confirmed payment${count === 1 ? "" : "s"})${refunds > 0 ? `, minus ${money(refunds)} refunded` : ""}:`,
        ...lines,
      ].join("\n"),
      references: refs,
      facts: `Payments ${period.label}: in ${money(moneyIn)}, refunds ${money(refunds)}.`,
    };
  }

  /* ----- sales summary ----- */
  if (/\b(sale|sales|sold|revenue|turnover|business today|how are we doing)\b/.test(q) && can("sales.view")) {
    const period = periodFromQuestion(q);
    const own = !can("sales.view_all");
    const summary = await salesSummary(period, own ? user.id : null);
    const scope = own ? "your" : "total";
    const facts = `${period.label} (${scope}): ${summary.count} sales, revenue ${money(summary.revenue)}, collected ${money(summary.collected)}, outstanding ${money(summary.outstanding)}.`;
    return {
      answer: [
        `**Sales ${period.label}${own ? " (yours)" : ""}:**`,
        `- ${summary.count} completed sale${summary.count === 1 ? "" : "s"} worth **${money(summary.revenue)}**`,
        `- Collected so far: ${money(summary.collected)}`,
        `- Still outstanding: ${money(summary.outstanding)}`,
        summary.count === 0 ? `\nNo completed sales in this window — try "sales this week" or "sales this month".` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      references: refs,
      facts,
    };
  }

  /* ----- fallback: capabilities + today snapshot ----- */
  const period = { from: utcDayStart(new Date()), to: (() => { const d = utcDayStart(new Date()); d.setUTCDate(d.getUTCDate() + 1); return d; })(), label: "today" };
  const snap = can("sales.view") ? await salesSummary(period, can("sales.view_all") ? null : user.id) : null;
  const lowCount = can("inventory.view")
    ? allProducts.filter((p) => Number(p.currentStock) <= Number(p.reorderLevel)).length
    : 0;

  const capabilities = [
    `I can answer questions about **live company data**. Try things like:`,
    `- "How much stock of Alva 5000 do we have?"`,
    `- "What is the price of Polar Elite 4LTS?"`,
    can("customers.view") ? `- "How much does [customer] owe us?" or "Who owes us?"` : "",
    can("sales.view") ? `- "Sales today" / "Sales this week" / "Best sellers this month"` : "",
    can("payments.view") ? `- "Payments received today"` : "",
    can("expenses.view") ? `- "Expenses this month"` : "",
    can("inventory.view") ? `- "Which products are low on stock?"` : "",
    can("prices.view_cost") ? `- "Profit this month"` : "",
    `- "Sale SO-20260801-0001" (look up any order number)`,
  ].filter(Boolean);

  const snapshot = snap
    ? [
        ``,
        `**Quick snapshot — today:** ${snap.count} sale${snap.count === 1 ? "" : "s"} (${money(snap.revenue)})` +
          (lowCount > 0 ? ` · ⚠️ ${lowCount} product${lowCount === 1 ? "" : "s"} low on stock` : ""),
      ]
    : [];

  return {
    answer: [...capabilities, ...snapshot].join("\n"),
    references: refs,
    facts: snapshot.join(" ") || "No data snapshot available.",
  };
}

function deny(what: string, refs: EntityRef[]): AiAnswer {
  return {
    answer: `You don't have permission to view ${what}. An admin can adjust your access under **Permissions** if you need it.`,
    references: refs,
    facts: `Permission denied for ${what}.`,
  };
}

/**
 * Friendly replies for chit-chat so the assistant feels alive even without
 * an LLM key. Returns null when the message isn't small talk.
 */
function smallTalkAnswer(q: string, firstName: string, can: (key: string) => boolean): string | null {
  const hint = can("sales.view")
    ? `Ask me things like **"sales today"**, **"who owes us?"**, **"stock of Alva 5000"** or **"profit this month"** — I answer straight from the live company data.`
    : `Ask me about things like **"stock of Alva 5000"** or **"price of Polar Elite 4LTS"** — I answer straight from the live company data.`;

  if (/^(hi+|hello+|hey+|yo|hiya|howdy|good\s?(morning|afternoon|evening|day)|salaam|assalamu\s?alaikum)[\s!.,]*$/.test(q)) {
    const daypart = new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening";
    return `Good ${daypart}, ${firstName}! 👋 Great to hear from you.\n\n${hint}`;
  }
  if (/^(how are you|how are you doing|how's it going|how far|how you dey)[\s?!.,]*$/.test(q)) {
    return `Doing well, thanks for asking, ${firstName}! Always ready to dig into the numbers. 😊\n\n${hint}`;
  }
  if (/^(thank|thanks|thank you|thx|appreciated?|well done|nice one)[\s!.,]*$/.test(q)) {
    return `You're very welcome, ${firstName}! 🙏 Anytime — just ask whenever you need a figure or a report.`;
  }
  if (/^(bye|goodbye|good\s?night|see you|later|take care)[\s!.,]*$/.test(q)) {
    return `Take care, ${firstName}! 👋 I'll be right here whenever you need the numbers.`;
  }
  if (/^(who are you|what are you|your name|introduce yourself)[\s?!.,]*$/.test(q)) {
    return `I'm the **Yabuz business assistant** — I sit on top of the company's live data and answer questions about stock, prices, sales, customers, credit, deposits, payments, expenses and profit.\n\n${hint}`;
  }
  if (/^(help|what can you do|what do you do|how do you work|guide|menu|options)[\s?!.,]*$/.test(q)) {
    return `Happy to help, ${firstName}! ${hint}`;
  }
  return null;
}

/* ------------------------------ optional LLM layer ------------------------------ */

interface AiSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function getAiSettings(): Promise<AiSettings> {
  const db = getDb();
  const rows = await db.select().from(settings).where(
    or(
      eq(settings.key, "ai.enabled"),
      eq(settings.key, "ai.api_key"),
      eq(settings.key, "ai.base_url"),
      eq(settings.key, "ai.model"),
    ),
  );
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value ? JSON.parse(r.value) : null;
  return {
    enabled: map["ai.enabled"] !== false,
    apiKey: String(map["ai.api_key"] ?? ""),
    baseUrl: String(map["ai.base_url"] ?? "https://api.moonshot.ai/v1").replace(/\/+$/, ""),
    model: String(map["ai.model"] ?? "kimi-k2-0905-preview"),
  };
}

/**
 * When an OpenAI-compatible key is configured, hand the retrieved facts to the
 * model for a more conversational reply. Returns null on any failure so the
 * caller falls back to the deterministic answer.
 */
export async function polishWithLlm(
  question: string,
  deterministic: AiAnswer,
  history: { role: "USER" | "ASSISTANT"; content: string }[],
  cfg: AiSettings,
): Promise<string | null> {
  if (!cfg.enabled || !cfg.apiKey) return null;
  try {
    const system = [
      `You are the built-in business assistant of YABUZ OIL AND GAS LTD, a Nigerian distributor of Polar Petrochemicals lubricants.`,
      `Answer the staff member's question using ONLY the verified facts retrieved from the company database below — never invent figures.`,
      `Keep the reply concise and friendly, format money as ₦ with thousands separators, and use short bullet points where helpful.`,
      `For greetings, thanks and small talk, respond warmly and naturally (you may use the staff member's name), then briefly offer what you can help with.`,
      `If the facts don't cover the question, say so honestly and suggest what the user can ask instead.`,
      ``,
      `VERIFIED FACTS FROM THE DATABASE:`,
      deterministic.facts,
    ].join("\n");

    const messages = [
      { role: "system", content: system },
      ...history.slice(-6).map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content.replace(/\n\n<!--refs:[\s\S]*?-->$/, ""),
      })),
      { role: "user", content: question },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
