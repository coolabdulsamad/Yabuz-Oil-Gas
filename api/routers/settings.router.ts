import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, inArray, or } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { settings } from "@db/schema";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — application settings router
 * Key-value store grouped by area. Each group is gated by its own
 * permission: BUSINESS/INVENTORY/INTEGRATIONS/CHAT/NOTIFICATIONS →
 * settings.business, SYSTEM → settings.system (Super Admin only).
 * publicConfig exposes the safe, non-secret toggles every staff member
 * needs (chat switches, notification switches) for UI gating.
 */

const GROUP_PERMISSION: Record<string, string> = {
  BUSINESS: "settings.business",
  INVENTORY: "settings.business",
  INTEGRATIONS: "settings.business",
  CHAT: "settings.business",
  NOTIFICATIONS: "settings.business",
  SYSTEM: "settings.system",
};

function permissionForGroup(group: string): string {
  return GROUP_PERMISSION[group] ?? "settings.system";
}

export const settingsRouter = createRouter({
  /** Settings visible to the current user (group-gated). */
  list: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(settings);
    return rows
      .filter((row) => ctx.permissions.has(permissionForGroup(row.group)))
      .map((row) => ({
        key: row.key,
        value: row.value ? (JSON.parse(row.value) as unknown) : null,
        group: row.group,
        description: row.description,
        updatedAt: row.updatedAt,
      }));
  }),

  /** Public-looking business identity for login page & receipts (any staff). */
  businessIdentity: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.group, "BUSINESS"));
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value ? JSON.parse(r.value) : null;
    return map;
  }),

  /** Cloudinary unsigned-upload config for proof/receipt uploads (any staff). */
  uploadConfig: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(
        or(
          eq(settings.key, "cloudinary.cloud_name"),
          eq(settings.key, "cloudinary.upload_preset"),
          eq(settings.key, "cloudinary.folder"),
        ),
      );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ? String(JSON.parse(r.value)) : "";
    const cloudName = map["cloudinary.cloud_name"] ?? "";
    const uploadPreset = map["cloudinary.upload_preset"] ?? "";
    const folder = map["cloudinary.folder"] ?? "";
    return { cloudName, uploadPreset, folder, configured: !!(cloudName && uploadPreset) };
  }),

  /** Safe feature toggles every staff UI needs (no secrets). */
  publicConfig: authedProcedure.query(async () => {
    const db = getDb();
    const wanted = [
      "chat.enabled",
      "chat.allow_group_creation",
      "chat.allow_message_delete",
      "notifications.enabled",
      "notifications.sound",
      "ai.enabled",
    ];
    const rows = await db.select().from(settings).where(inArray(settings.key, wanted));
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value ? JSON.parse(r.value) : null;
    const bool = (key: string, fallback: boolean) => (typeof map[key] === "boolean" ? (map[key] as boolean) : fallback);
    return {
      chatEnabled: bool("chat.enabled", true),
      allowGroupCreation: bool("chat.allow_group_creation", true),
      allowMessageDelete: bool("chat.allow_message_delete", true),
      notificationsEnabled: bool("notifications.enabled", true),
      notificationsSound: bool("notifications.sound", true),
      aiEnabled: bool("ai.enabled", true),
    };
  }),

  /** Update a batch of settings. Every key is checked against its group's permission. */
  update: authedProcedure
    .input(z.object({ values: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const keys = Object.keys(input.values);
      if (keys.length === 0) return { ok: true, updated: 0 };

      const existing = await db.select().from(settings);
      const byKey = new Map(existing.map((r) => [r.key, r]));

      const changes: { key: string; before: unknown; after: unknown }[] = [];

      for (const key of keys) {
        const row = byKey.get(key);
        if (!row) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown setting "${key}".` });
        }
        const needed = permissionForGroup(row.group);
        if (!ctx.permissions.has(needed)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You don't have permission to change ${row.group.toLowerCase()} settings (${needed}).`,
          });
        }
        const before = row.value ? JSON.parse(row.value) : null;
        const after = input.values[key];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;

        await db
          .update(settings)
          .set({ value: JSON.stringify(after ?? null), updatedBy: ctx.user.id })
          .where(eq(settings.key, key));
        changes.push({ key, before, after });
      }

      if (changes.length > 0) {
        await logAudit({
          actorId: ctx.user.id,
          action: "settings.update",
          entityType: "SETTING",
          entityId: changes.map((c) => c.key).join(","),
          description: `Updated ${changes.length} setting(s): ${changes.map((c) => c.key).join(", ")}.`,
          afterData: { changes },
          ...requestMeta(ctx.req),
        });
      }

      return { ok: true, updated: changes.length };
    }),
});
