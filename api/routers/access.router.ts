import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { rolePermissions, sessions, userPermissions, users } from "@db/schema";
import { PERMISSIONS, PERMISSION_KEYS } from "@contracts/permissions";
import { MANAGEABLE_ROLES, USER_ROLES, type UserRole } from "@contracts/roles";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — access control router
 * Role permission matrix (what each role can do) + per-user overrides
 * (grant or revoke a single key for one person, on top of their role).
 *
 * Rules:
 *  - SUPER_ADMIN's matrix is immutable (developer always has everything).
 *  - Admin cannot strip their own "permissions.manage" (lockout guard).
 *  - You only manage overrides for accounts inside your hierarchy.
 */

const EDITABLE_ROLES = USER_ROLES.filter((r) => r !== "SUPER_ADMIN") as UserRole[];

function assertCanManageUser(actorRole: UserRole, targetRole: UserRole) {
  if (actorRole !== "SUPER_ADMIN" && !(MANAGEABLE_ROLES[actorRole] ?? []).includes(targetRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your role cannot manage access for ${targetRole} accounts.`,
    });
  }
}

export const accessRouter = createRouter({
  /** Full matrix: every permission key × every role, with allowed flags. */
  roleMatrix: permissionProcedure("permissions.manage").query(async () => {
    const db = getDb();
    const rows = await db.select().from(rolePermissions);
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const role of USER_ROLES) {
      matrix[role] = {};
      for (const key of PERMISSION_KEYS) matrix[role][key] = role === "SUPER_ADMIN";
    }
    for (const row of rows) {
      if (row.role === "SUPER_ADMIN") continue;
      if (matrix[row.role]) matrix[row.role][row.permissionKey] = row.allowed;
    }
    return {
      permissions: PERMISSIONS,
      roles: USER_ROLES,
      editableRoles: EDITABLE_ROLES,
      matrix,
    };
  }),

  /** Toggle one permission for one role. */
  setRolePermission: permissionProcedure("permissions.manage")
    .input(
      z.object({
        role: z.enum(EDITABLE_ROLES as [UserRole, ...UserRole[]]),
        permissionKey: z.string().refine((k) => PERMISSION_KEYS.includes(k), "Unknown permission"),
        allowed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Lockout guard: an admin can't remove their own permission-management power.
      if (
        input.permissionKey === "permissions.manage" &&
        !input.allowed &&
        ctx.user.role === input.role
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove permission management from your own role.",
        });
      }

      await db
        .insert(rolePermissions)
        .values({
          role: input.role,
          permissionKey: input.permissionKey,
          allowed: input.allowed,
          updatedBy: ctx.user.id,
        })
        .onDuplicateKeyUpdate({ set: { allowed: input.allowed, updatedBy: ctx.user.id } });

      await logAudit({
        actorId: ctx.user.id,
        action: "access.role_permission",
        entityType: "ROLE_PERMISSION",
        entityId: `${input.role}:${input.permissionKey}`,
        description: `${input.allowed ? "Granted" : "Revoked"} "${input.permissionKey}" for role ${input.role}.`,
        afterData: input,
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),

  /**
   * One user's access sheet: role base permissions + their overrides,
   * plus the resolved effective set. Only for accounts you manage.
   */
  userAccess: permissionProcedure("permissions.manage")
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      const target = found[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found." });
      assertCanManageUser(ctx.user.role, target.role as UserRole);

      const roleRows = await db
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.role, target.role), eq(rolePermissions.allowed, true)));
      const roleBase = new Set(roleRows.map((r) => r.permissionKey));

      const overrideRows = await db
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, input.userId));

      return {
        user: {
          id: target.id,
          username: target.username,
          fullName: target.fullName,
          role: target.role,
          staffCode: target.staffCode,
        },
        roleBase: [...roleBase],
        overrides: overrideRows.map((o) => ({
          permissionKey: o.permissionKey,
          allowed: o.allowed,
        })),
      };
    }),

  /**
   * Set or clear one override for a user.
   * allowed=true → grant a key the role lacks; false → revoke one it has;
   * pass allowed=null to clear the override (fall back to role default).
   */
  setUserOverride: permissionProcedure("permissions.manage")
    .input(
      z.object({
        userId: z.number(),
        permissionKey: z.string().refine((k) => PERMISSION_KEYS.includes(k), "Unknown permission"),
        allowed: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      const target = found[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found." });
      assertCanManageUser(ctx.user.role, target.role as UserRole);

      if (input.allowed === null) {
        await db
          .delete(userPermissions)
          .where(
            and(
              eq(userPermissions.userId, input.userId),
              eq(userPermissions.permissionKey, input.permissionKey),
            ),
          );
      } else {
        await db
          .insert(userPermissions)
          .values({
            userId: input.userId,
            permissionKey: input.permissionKey,
            allowed: input.allowed,
            grantedBy: ctx.user.id,
          })
          .onDuplicateKeyUpdate({
            set: { allowed: input.allowed, grantedBy: ctx.user.id },
          });
      }

      // Effective permissions changed → force fresh login.
      await db.delete(sessions).where(eq(sessions.userId, input.userId));

      await logAudit({
        actorId: ctx.user.id,
        action: "access.user_override",
        entityType: "USER_PERMISSION",
        entityId: `${input.userId}:${input.permissionKey}`,
        description:
          input.allowed === null
            ? `Cleared override "${input.permissionKey}" for "${target.username}".`
            : `${input.allowed ? "Granted" : "Revoked"} "${input.permissionKey}" for "${target.username}" (override).`,
        afterData: input,
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),
});
