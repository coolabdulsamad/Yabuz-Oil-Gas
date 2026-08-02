import { and, eq, inArray } from "drizzle-orm";
import { notifications, users } from "@db/schema";
import type { getDb } from "../queries/connection";
import { getSettingBool } from "./settings.service";

/**
 * YABUZ OIL & GAS — notification fan-out
 * Every alert in the system (chat messages, approval requests and results)
 * lands in the notifications table and surfaces in the header bell.
 * Honors the global notifications.enabled switch from Settings → Notifications.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Notice {
  type: "CHAT" | "APPROVAL_REQUEST" | "APPROVAL_RESULT" | "PAYMENT" | "SYSTEM";
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Insert a notification for a set of users (deduped). */
export async function notifyUsers(db: Db | Tx, userIds: number[], notice: Notice) {
  const unique = [...new Set(userIds)].filter((id) => Number.isFinite(id) && id > 0);
  if (unique.length === 0) return;
  const enabled = await getSettingBool(db, "notifications.enabled", true);
  if (!enabled) return;
  await db.insert(notifications).values(
    unique.map((userId) => ({
      userId,
      type: notice.type,
      title: notice.title.slice(0, 200),
      body: notice.body ? notice.body.slice(0, 500) : null,
      link: notice.link ? notice.link.slice(0, 300) : null,
    })),
  );
}

/** Insert a notification for every ACTIVE user holding one of the given roles. */
export async function notifyRoles(db: Db | Tx, roles: string[], notice: Notice, excludeIds: number[] = []) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roles as Array<"SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SALES">), eq(users.status, "ACTIVE")));
  const excluded = new Set(excludeIds);
  await notifyUsers(db, rows.map((r) => r.id).filter((id) => !excluded.has(id)), notice);
}
