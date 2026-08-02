import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { users, settings } from "./schema";
import { eq } from "drizzle-orm";

/**
 * YABUZ OIL & GAS — v2 settings seed (idempotent).
 * Adds the new keys for the expanded Settings page: Cloudinary API key/secret,
 * receipt config, team-chat switches and notification switches.
 * Existing values are NEVER overwritten (only descriptions refresh).
 * Run with:  npx tsx db/seed-settings-v2.ts
 */

const db = drizzle(process.env.DATABASE_URL!, { mode: "planetscale" });

const NEW_SETTINGS: Array<[string, unknown, string, string]> = [
  ["business.rc_number", "", "BUSINESS", "CAC registration number (printed on receipts)"],
  ["business.receipt_footer", "Thank you for your patronage!", "BUSINESS", "Footnote printed at the bottom of sales receipts"],
  ["cloudinary.api_key", "", "INTEGRATIONS", "Cloudinary API key (for signed server operations)"],
  ["cloudinary.api_secret", "", "INTEGRATIONS", "Cloudinary API secret — keep it private"],
  ["cloudinary.folder", "yabuz", "INTEGRATIONS", "Cloudinary folder uploads go into"],
  ["chat.enabled", true, "CHAT", "Turn team chat on/off for the whole company"],
  ["chat.allow_group_creation", true, "CHAT", "Allow all staff to create group chats (off = admins only)"],
  ["chat.allow_message_delete", true, "CHAT", "Allow staff to delete their own messages (off = moderators only)"],
  ["notifications.enabled", true, "NOTIFICATIONS", "Master switch for in-app notifications (bell)"],
  ["notifications.sound", true, "NOTIFICATIONS", "Play sounds for chat and notifications (staff can mute for themselves)"],
];

async function main() {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, "superadmin")).limit(1);
  console.log("🌱 Seeding v2 settings…");
  for (const [key, value, group, description] of NEW_SETTINGS) {
    await db
      .insert(settings)
      .values({ key, value: JSON.stringify(value), group, description, updatedBy: admin?.id ?? null })
      .onDuplicateKeyUpdate({ set: { description, group } });
    console.log(`  ✔ ${key}`);
  }
  console.log("✅ v2 settings seeded");
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
