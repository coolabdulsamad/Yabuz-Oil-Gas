import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema";
import { SEED_PRODUCTS } from "./seeds-data";
import { DEFAULT_ROLE_PERMISSIONS, USER_ROLES } from "../contracts/index";

/**
 * YABUZ OIL & GAS — database seed.
 * Run with:  npx tsx db/seed.ts
 *
 * Creates: staff users, role permission matrix, app settings, approval
 * flow defaults, Polar supplier, 9 categories, 30 real products with
 * current + old price lists, and opening stock from the Excel records.
 */

const db = drizzle(process.env.DATABASE_URL!, { schema, mode: "planetscale" });

const {
  users, rolePermissions, settings, approvalFlows, suppliers, categories,
  products, priceLists, priceListItems, stockMovements, expenseCategories,
} = schema;

async function main() {
  console.log("🌱 Seeding Yabuz Oil & Gas…");

  /* ---------------- 1. Staff users ---------------- */
  const password = await bcrypt.hash("Yabuz@123", 10);
  const staffSeed = [
    { username: "superadmin", fullName: "Super Admin", role: "SUPER_ADMIN", staffCode: "YOG-0001" },
    { username: "admin", fullName: "Company Admin", role: "ADMIN", staffCode: "YOG-0002" },
    { username: "manager", fullName: "Store Manager", role: "MANAGER", staffCode: "YOG-0003" },
    { username: "sales1", fullName: "Sales Officer 1", role: "SALES", staffCode: "YOG-0004" },
  ] as const;

  const userIds: Record<string, number> = {};
  for (const s of staffSeed) {
    const existing = await db.select().from(users).where(eq(users.username, s.username)).limit(1);
    if (existing[0]) {
      userIds[s.username] = existing[0].id;
      continue;
    }
    const [{ id }] = await db
      .insert(users)
      .values({ ...s, passwordHash: password })
      .$returningId();
    userIds[s.username] = id;
  }
  const superAdminId = userIds["superadmin"];
  console.log("✔ users:", Object.keys(userIds).join(", "));

  /* ---------------- 2. Role permission matrix ---------------- */
  for (const role of USER_ROLES) {
    for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
      await db
        .insert(rolePermissions)
        .values({ role, permissionKey: key, allowed: true, updatedBy: superAdminId })
        .onDuplicateKeyUpdate({ set: { allowed: true } });
    }
  }
  console.log("✔ role permissions");

  /* ---------------- 3. App settings ---------------- */
  const settingsSeed: Array<[string, unknown, string, string]> = [
    ["business.name", "YABUZ OIL AND GAS LTD", "BUSINESS", "Registered company name"],
    ["business.tagline", "Authorized distributor of Polar Petrochemicals products", "BUSINESS", "Short company description"],
    ["business.address", "", "BUSINESS", "Company address"],
    ["business.phone", "", "BUSINESS", "Company phone"],
    ["business.email", "", "BUSINESS", "Company email"],
    ["sales.currency", "NGN", "BUSINESS", "Trading currency"],
    ["sales.currency_symbol", "₦", "BUSINESS", "Currency symbol"],
    ["sales.allow_credit_without_limit", false, "BUSINESS", "Allow credit sales to customers with no credit limit"],
    ["inventory.low_stock_default", 5, "INVENTORY", "Default reorder level (packs) when a product has none set"],
    ["system.session_hours", 12, "SYSTEM", "Login session lifetime in hours"],
    ["system.company_initials", "YOG", "SYSTEM", "Prefix for staff codes and references"],
    ["cloudinary.cloud_name", "", "INTEGRATIONS", "Cloudinary cloud name (set in Settings → Integrations)"],
    ["cloudinary.upload_preset", "", "INTEGRATIONS", "Cloudinary unsigned upload preset"],
    ["ai.enabled", true, "INTEGRATIONS", "Enable the AI assistant"],
    ["ai.api_key", "", "INTEGRATIONS", "OpenAI-compatible API key (e.g. Moonshot/Kimi) — empty = built-in data assistant only"],
    ["ai.base_url", "https://api.moonshot.ai/v1", "INTEGRATIONS", "OpenAI-compatible API base URL for the AI assistant"],
    ["ai.model", "kimi-k2-0905-preview", "INTEGRATIONS", "Model name used when an AI API key is configured"],
  ];
  for (const [key, value, group, description] of settingsSeed) {
    await db
      .insert(settings)
      .values({ key, value: JSON.stringify(value), group, description, updatedBy: superAdminId })
      .onDuplicateKeyUpdate({ set: { description } });
  }
  console.log("✔ settings");

  /* ---------------- 4. Default approval flows ---------------- */
  const flowSeed: Array<[string, string[]]> = [
    ["SALE", ["MANAGER"]],
    ["PAYMENT", ["MANAGER"]],
    ["DEPOSIT", ["MANAGER"]],
    ["EXPENSE", ["MANAGER", "ADMIN"]],
    ["PRODUCT", ["ADMIN"]],
    ["PRICE_LIST", ["ADMIN"]],
    ["STOCK_ADJUSTMENT", ["MANAGER", "ADMIN"]],
    ["STOCK_COUNT", ["ADMIN"]],
    ["PURCHASE_ORDER", ["ADMIN"]],
    ["CUSTOMER_CREDIT", ["ADMIN"]],
  ];
  for (const [entityType, steps] of flowSeed) {
    await db
      .insert(approvalFlows)
      .values({ entityType: entityType as never, steps, updatedBy: superAdminId })
      .onDuplicateKeyUpdate({ set: { steps } });
  }
  console.log("✔ approval flows");

  /* ---------------- 5. Supplier (producer) ---------------- */
  let polar = (await db.select().from(suppliers).where(eq(suppliers.name, "POLAR PETROCHEMICALS LIMITED")).limit(1))[0];
  if (!polar) {
    const [{ id }] = await db
      .insert(suppliers)
      .values({ name: "POLAR PETROCHEMICALS LIMITED", notes: "Producer / main supplier of all Polar products." })
      .$returningId();
    polar = (await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1))[0];
  }
  console.log("✔ supplier: Polar Petrochemicals");

  /* ---------------- 6. Categories + products ---------------- */
  const catIds: Record<string, number> = {};
  const catNames = [...new Map(SEED_PRODUCTS.map((p) => [p.cat, p.catName])).entries()];
  for (const [code, name] of catNames) {
    const existing = (await db.select().from(categories).where(eq(categories.code, code)).limit(1))[0];
    if (existing) {
      catIds[code] = existing.id;
      continue;
    }
    const [{ id }] = await db.insert(categories).values({ code, name }).$returningId();
    catIds[code] = id;
  }

  const prodIds: number[] = [];
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const p = SEED_PRODUCTS[i];
    const sku = `POL-${p.cat}${String(i + 1).padStart(2, "0")}`;
    const existing = (await db.select().from(products).where(eq(products.name, p.name)).limit(1))[0];
    if (existing) {
      prodIds.push(existing.id);
      continue;
    }
    const packMatch = p.name.match(/\(([^)]+)\)/);
    const [{ id }] = await db
      .insert(products)
      .values({
        sku,
        name: p.name,
        categoryId: catIds[p.cat],
        supplierId: polar.id,
        packType: p.packType,
        packDescription: packMatch ? packMatch[1] : p.name,
        unitsPerPack: p.unitsPerPack,
        unitLabel: p.unitLabel,
        volumePerUnit: p.volumePerUnit,
        costCartonPrice: p.pc,
        costUnitPrice: p.pu,
        sellCartonPrice: p.mc,
        sellUnitPrice: p.mu,
        currentStock: p.qty,
        reorderLevel: 5,
        approvalStatus: "APPROVED",
        createdBy: superAdminId,
      })
      .$returningId();
    prodIds.push(id);
  }
  console.log(`✔ categories: ${catNames.length}, products: ${prodIds.length}`);

  /* ---------------- 7. Price lists (current + previous batch) ---------------- */
  let currentList = (await db.select().from(priceLists).where(eq(priceLists.name, "CURRENT PRICE LIST")).limit(1))[0];
  if (!currentList) {
    const [{ id }] = await db
      .insert(priceLists)
      .values({
        name: "CURRENT PRICE LIST",
        description: "Active public price list (from POLAR OIL PUBLIC PRICE LIST FOR YABUZ OIL.xlsx).",
        isActive: true,
        approvalStatus: "APPROVED",
        publishedBy: superAdminId,
        publishedAt: new Date(),
        createdBy: superAdminId,
      })
      .$returningId();
    currentList = (await db.select().from(priceLists).where(eq(priceLists.id, id)).limit(1))[0];

    for (let i = 0; i < SEED_PRODUCTS.length; i++) {
      const p = SEED_PRODUCTS[i];
      await db.insert(priceListItems).values({
        priceListId: id,
        productId: prodIds[i],
        producerCartonPrice: p.pc,
        producerUnitPrice: p.pu,
        marketerCartonPrice: p.mc,
        marketerUnitPrice: p.mu,
        cartonGain: Math.round((p.mc - p.pc) * 100) / 100,
        unitGain: Math.round((p.mu - p.pu) * 100) / 100,
        oldPrice: p.oldPrice,
      });
    }
  }

  let batchA = (await db.select().from(priceLists).where(eq(priceLists.name, "BATCH A (OLD)")).limit(1))[0];
  if (!batchA) {
    const [{ id }] = await db
      .insert(priceLists)
      .values({
        name: "BATCH A (OLD)",
        description: "Previous price list kept for history (from YABUZ OIL AND GAS POLAR OIL PRICE LIST.xlsx).",
        isActive: false,
        approvalStatus: "APPROVED",
        publishedBy: superAdminId,
        publishedAt: new Date(),
        createdBy: superAdminId,
      })
      .$returningId();
    for (let i = 0; i < SEED_PRODUCTS.length; i++) {
      const p = SEED_PRODUCTS[i];
      const oldCarton = p.oldPrice ?? p.mc;
      await db.insert(priceListItems).values({
        priceListId: id,
        productId: prodIds[i],
        producerCartonPrice: p.pc,
        producerUnitPrice: p.pu,
        marketerCartonPrice: oldCarton,
        marketerUnitPrice: p.mu,
        cartonGain: Math.round((oldCarton - p.pc) * 100) / 100,
        unitGain: Math.round((p.mu - p.pu) * 100) / 100,
      });
    }
  }
  console.log("✔ price lists: CURRENT + BATCH A (OLD)");

  /* ---------------- 8. Opening stock movements ---------------- */
  const existingMovements = await db.select({ id: stockMovements.id }).from(stockMovements).limit(1);
  if (existingMovements.length === 0) {
    for (let i = 0; i < SEED_PRODUCTS.length; i++) {
      const p = SEED_PRODUCTS[i];
      if (p.qty <= 0) continue;
      await db.insert(stockMovements).values({
        productId: prodIds[i],
        movementType: "SUPPLY_IN",
        quantity: p.qty,
        balanceAfter: p.qty,
        referenceType: "OPENING",
        reason: "Opening store balance (from monthly inventory records)",
        performedBy: superAdminId,
      });
    }
    console.log("✔ opening stock movements");
  }

  /* ---------------- 9. Expense categories ---------------- */
  const expCats = ["Transport & Logistics", "Loading & Offloading", "Store Rent", "Salaries & Wages", "Utilities", "Fuel & Generator", "Repairs & Maintenance", "Office Supplies", "Miscellaneous"];
  for (const name of expCats) {
    await db
      .insert(expenseCategories)
      .values({ name })
      .onDuplicateKeyUpdate({ set: { name } });
  }
  console.log("✔ expense categories");

  console.log("\n✅ Seed complete. Login accounts (password: Yabuz@123):");
  console.log("   superadmin · admin · manager · sales1");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
