import "dotenv/config";
import mysql from "mysql2/promise";

/**
 * YABUZ OIL & GAS — v2 schema additions (additive only, idempotent).
 *   customers: full company/customer detail columns
 *   approval_flows: unique key on entity_type (already declared in schema)
 * Safe to run repeatedly — every statement checks information_schema first.
 * Run with:  npx tsx db/migrate-v2.ts
 */

const NEW_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "customer_type", ddl: "ADD COLUMN `customer_type` enum('INDIVIDUAL','BUSINESS') NOT NULL DEFAULT 'BUSINESS' AFTER `full_name`" },
  { name: "contact_person", ddl: "ADD COLUMN `contact_person` varchar(160) NULL" },
  { name: "alt_phone", ddl: "ADD COLUMN `alt_phone` varchar(40) NULL" },
  { name: "website", ddl: "ADD COLUMN `website` varchar(160) NULL" },
  { name: "tin", ddl: "ADD COLUMN `tin` varchar(60) NULL" },
  { name: "rc_number", ddl: "ADD COLUMN `rc_number` varchar(60) NULL" },
  { name: "delivery_address", ddl: "ADD COLUMN `delivery_address` text NULL" },
  { name: "city", ddl: "ADD COLUMN `city` varchar(100) NULL" },
  { name: "state", ddl: "ADD COLUMN `state` varchar(100) NULL" },
  { name: "country", ddl: "ADD COLUMN `country` varchar(100) NULL DEFAULT 'Nigeria'" },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [dbRows] = await conn.query("SELECT DATABASE() AS db");
  const dbName = (dbRows as Array<{ db: string }>)[0].db;
  console.log(`🔧 Migrating ${dbName}…`);

  const [colRows] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers'",
    [dbName],
  );
  const existing = new Set((colRows as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME));

  for (const col of NEW_COLUMNS) {
    if (existing.has(col.name)) {
      console.log(`  ⏭  customers.${col.name} already exists`);
      continue;
    }
    await conn.query(`ALTER TABLE \`customers\` ${col.ddl}`);
    console.log(`  ✔  added customers.${col.name}`);
  }

  const [idxRows] = await conn.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'approval_flows' AND NON_UNIQUE = 0 AND INDEX_NAME != 'PRIMARY'",
    [dbName],
  );
  const hasUnique = (idxRows as Array<{ INDEX_NAME: string }>).some((r) => r.INDEX_NAME.includes("entity_type"));
  if (hasUnique) {
    console.log("  ⏭  approval_flows.entity_type unique key already exists");
  } else {
    await conn.query("ALTER TABLE `approval_flows` ADD UNIQUE KEY `approval_flows_entity_type_unique` (`entity_type`)");
    console.log("  ✔  added approval_flows.entity_type unique key");
  }

  await conn.end();
  console.log("✅ v2 migration complete");
}

main().catch((err) => {
  console.error("❌ migration failed:", err);
  process.exit(1);
});
