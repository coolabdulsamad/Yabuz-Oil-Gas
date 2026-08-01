import { getDb } from "../queries/connection";
import { auditLogs, users } from "@db/schema";
import { eq } from "drizzle-orm";

/**
 * YABUZ OIL & GAS — Audit service
 * Every sensitive action in the system calls logAudit().
 * Stored: actor snapshot, action, entity, before → after JSON, IP, device.
 */

export interface AuditEntry {
  actorId?: number | null;
  action: string; // e.g. "auth.login", "sale.create", "payment.confirm"
  entityType: string; // e.g. "PRODUCT", "SALE", "USER", "SYSTEM"
  entityId?: string | number | null;
  description: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAudit(entry: AuditEntry) {
  try {
    const db = getDb();

    let actorName = "System";
    let actorRole = "SUPER_ADMIN";
    if (entry.actorId) {
      const actor = await db
        .select({ fullName: users.fullName, role: users.role })
        .from(users)
        .where(eq(users.id, entry.actorId))
        .limit(1);
      if (actor[0]) {
        actorName = actor[0].fullName;
        actorRole = actor[0].role;
      }
    }

    await db.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      actorName,
      actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      description: entry.description,
      beforeData: entry.beforeData ?? null,
      afterData: entry.afterData ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    // Auditing must never break the main action — log to server console instead.
    console.error("[audit] failed to record:", entry.action, err);
  }
}

/** Extract client IP + device from a Request for audit trails. */
export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}
