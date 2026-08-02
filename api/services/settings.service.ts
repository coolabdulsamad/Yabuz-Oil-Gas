import { eq } from "drizzle-orm";
import { settings } from "@db/schema";
import type { getDb } from "../queries/connection";

/**
 * YABUZ OIL & GAS — settings read helpers
 * Tiny cached-free readers for feature toggles checked on hot paths
 * (chat send, notification fan-out). Values are JSON-encoded in the
 * settings table.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getSettingValue(db: Db | Tx, key: string): Promise<unknown> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  if (!row?.value) return undefined;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return undefined;
  }
}

export async function getSettingBool(db: Db | Tx, key: string, fallback: boolean): Promise<boolean> {
  const v = await getSettingValue(db, key);
  return typeof v === "boolean" ? v : fallback;
}
