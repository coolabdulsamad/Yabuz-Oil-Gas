import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { sessions, users } from "@db/schema";
import { MANAGEABLE_ROLES, USER_ROLES, type UserRole } from "@contracts/roles";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — staff management router
 * Hierarchy-enforced: you can only see/manage roles below you
 * (SUPER_ADMIN → everyone, ADMIN → managers & sales, MANAGER → sales).
 */

/** Roles the current user is allowed to manage. */
function manageableRoles(role: UserRole): UserRole[] {
  return MANAGEABLE_ROLES[role] ?? [];
}

/** Throw unless the actor may manage a user with `targetRole`. */
function assertCanManage(actorRole: UserRole, targetRole: UserRole) {
  if (!manageableRoles(actorRole).includes(targetRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your role cannot manage ${targetRole} accounts.`,
    });
  }
}

/** Staff code like YOG-0005 — derived from the real assigned id (TiDB id allocation can jump). */
function staffCodeFor(id: number): string {
  return `YOG-${String(id).padStart(4, "0")}`;
}

/** Shared staff profile & bank detail fields (payroll uses the bank details to pay salaries). */
const staffFields = {
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  department: z.string().max(120).optional().or(z.literal("")),
  jobTitle: z.string().max(120).optional().or(z.literal("")),
  dateEmployed: z.string().optional().or(z.literal("")),
  homeAddress: z.string().max(2000).optional().or(z.literal("")),
  nextOfKinName: z.string().max(160).optional().or(z.literal("")),
  nextOfKinPhone: z.string().max(40).optional().or(z.literal("")),
  bankName: z.string().max(120).optional().or(z.literal("")),
  bankAccountNumber: z.string().max(20).optional().or(z.literal("")),
  bankAccountName: z.string().max(160).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
};

interface StaffFieldValues {
  email?: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  dateEmployed?: string;
  homeAddress?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  notes?: string;
}

function staffValues(input: StaffFieldValues) {
  return {
    email: input.email || null,
    phone: input.phone || null,
    department: input.department || null,
    jobTitle: input.jobTitle || null,
    dateEmployed: input.dateEmployed ? new Date(`${input.dateEmployed}T00:00:00`) : null,
    homeAddress: input.homeAddress || null,
    nextOfKinName: input.nextOfKinName || null,
    nextOfKinPhone: input.nextOfKinPhone || null,
    bankName: input.bankName || null,
    bankAccountNumber: input.bankAccountNumber || null,
    bankAccountName: input.bankAccountName || null,
    notes: input.notes || null,
  };
}

const createInput = z.object({
  fullName: z.string().min(2, "Full name is required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only"),
  role: z.enum(USER_ROLES),
  password: z.string().min(8, "Password must be at least 8 characters"),
  ...staffFields,
});

const updateInput = z.object({
  id: z.number(),
  fullName: z.string().min(2),
  role: z.enum(USER_ROLES),
  ...staffFields,
});

export const usersRouter = createRouter({
  /** Staff directory — yourself plus every role you can manage. */
  list: permissionProcedure("users.view").query(async ({ ctx }) => {
    const db = getDb();
    const visibleRoles = [ctx.user.role, ...manageableRoles(ctx.user.role)];
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        role: users.role,
        status: users.status,
        avatarUrl: users.avatarUrl,
        staffCode: users.staffCode,
        department: users.department,
        jobTitle: users.jobTitle,
        dateEmployed: users.dateEmployed,
        homeAddress: users.homeAddress,
        nextOfKinName: users.nextOfKinName,
        nextOfKinPhone: users.nextOfKinPhone,
        bankName: users.bankName,
        bankAccountNumber: users.bankAccountNumber,
        bankAccountName: users.bankAccountName,
        notes: users.notes,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(inArray(users.role, visibleRoles))
      .orderBy(users.id);
    return rows;
  }),

  /** Create a staff account within your hierarchy. */
  create: permissionProcedure("users.manage")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      assertCanManage(ctx.user.role, input.role as UserRole);

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username.trim()))
        .limit(1);
      if (existing[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "That username is already taken." });
      }

      const [{ id: newId }] = await db
        .insert(users)
        .values({
          username: input.username.trim(),
          passwordHash: bcrypt.hashSync(input.password, 10),
          fullName: input.fullName.trim(),
          role: input.role,
          ...staffValues(input),
          createdBy: ctx.user.id,
        })
        .$returningId();
      const staffCode = staffCodeFor(newId);
      await db.update(users).set({ staffCode }).where(eq(users.id, newId));

      await logAudit({
        actorId: ctx.user.id,
        action: "user.create",
        entityType: "USER",
        entityId: staffCode,
        description: `Created ${input.role} account "${input.username}" (${input.fullName}).`,
        afterData: { username: input.username, role: input.role, staffCode },
        ...requestMeta(ctx.req),
      });

      return { ok: true, staffCode };
    }),

  /** Edit a staff account you manage. */
  update: permissionProcedure("users.manage")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const target = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      const t = target[0];
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found." });
      assertCanManage(ctx.user.role, t.role as UserRole);
      assertCanManage(ctx.user.role, input.role as UserRole);

      await db
        .update(users)
        .set({
          fullName: input.fullName.trim(),
          role: input.role,
          ...staffValues(input),
        })
        .where(eq(users.id, input.id));

      // Role changed → kill sessions so permissions refresh on next login.
      if (t.role !== input.role) {
        await db.delete(sessions).where(eq(sessions.userId, input.id));
      }

      await logAudit({
        actorId: ctx.user.id,
        action: "user.update",
        entityType: "USER",
        entityId: input.id,
        description: `Updated staff "${t.username}"${t.role !== input.role ? ` (role ${t.role} → ${input.role})` : ""}.`,
        beforeData: { fullName: t.fullName, role: t.role, email: t.email, phone: t.phone },
        afterData: { fullName: input.fullName, role: input.role, email: input.email, phone: input.phone },
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),

  /** Suspend or reactivate an account. Suspended users are logged out immediately. */
  setStatus: permissionProcedure("users.manage")
    .input(z.object({ id: z.number(), status: z.enum(["ACTIVE", "SUSPENDED"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot suspend your own account." });
      }
      const target = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      const t = target[0];
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found." });
      assertCanManage(ctx.user.role, t.role as UserRole);

      await db.update(users).set({ status: input.status }).where(eq(users.id, input.id));
      if (input.status === "SUSPENDED") {
        await db.delete(sessions).where(eq(sessions.userId, input.id));
      }

      await logAudit({
        actorId: ctx.user.id,
        action: input.status === "SUSPENDED" ? "user.suspend" : "user.reactivate",
        entityType: "USER",
        entityId: input.id,
        description: `${input.status === "SUSPENDED" ? "Suspended" : "Reactivated"} staff "${t.username}".`,
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),

  /** Reset a staff member's password (kills their sessions). */
  resetPassword: permissionProcedure("users.manage")
    .input(z.object({ id: z.number(), password: z.string().min(8, "Password must be at least 8 characters") }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const target = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      const t = target[0];
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Staff account not found." });
      assertCanManage(ctx.user.role, t.role as UserRole);

      await db
        .update(users)
        .set({ passwordHash: bcrypt.hashSync(input.password, 10) })
        .where(eq(users.id, input.id));
      await db.delete(sessions).where(eq(sessions.userId, input.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "user.reset_password",
        entityType: "USER",
        entityId: input.id,
        description: `Reset password for staff "${t.username}".`,
        ...requestMeta(ctx.req),
      });

      return { ok: true };
    }),

  /** Roles the current user may assign when creating/editing staff. */
  assignableRoles: permissionProcedure("users.manage").query(({ ctx }) => {
    return manageableRoles(ctx.user.role);
  }),
});
