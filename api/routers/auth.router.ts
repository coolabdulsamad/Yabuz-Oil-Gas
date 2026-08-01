import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../trpc";
import {
  changePassword,
  clearSessionCookieHeader,
  login,
  logout,
  sessionCookieHeader,
} from "../services/auth.service";
import { logAudit, requestMeta } from "../services/audit.service";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";

/**
 * YABUZ OIL & GAS — auth router
 * login / logout / me / changePassword / updateProfile
 */
export const authRouter = createRouter({
  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1, "Username is required").max(60),
        password: z.string().min(1, "Password is required").max(120),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const meta = requestMeta(ctx.req);
      try {
        const result = await login(input.username, input.password);

        ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(result.sessionToken, result.expiresAt));

        await logAudit({
          actorId: result.user.id,
          action: "auth.login",
          entityType: "USER",
          entityId: result.user.id,
          description: `${result.user.fullName} (${result.user.role}) logged in.`,
          ...meta,
        });

        return { user: result.user, permissions: result.permissions };
      } catch (err) {
        await logAudit({
          actorId: null,
          action: "auth.login_failed",
          entityType: "USER",
          entityId: null,
          description: `Failed login attempt for username "${input.username}".`,
          ...meta,
        });
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: err instanceof Error ? err.message : "Login failed.",
        });
      }
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) await logout(ctx.sessionToken);
    ctx.resHeaders.append("Set-Cookie", clearSessionCookieHeader());

    await logAudit({
      actorId: ctx.user.id,
      action: "auth.logout",
      entityType: "USER",
      entityId: ctx.user.id,
      description: `${ctx.user.fullName} logged out.`,
      ...requestMeta(ctx.req),
    });

    return { ok: true };
  }),

  me: publicQuery.query(({ ctx }) => {
    if (!ctx.user) return null;
    return { user: ctx.user, permissions: [...ctx.permissions] };
  }),

  changePassword: authedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "New password must be at least 8 characters").max(120),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await changePassword(ctx.user.id, input.currentPassword, input.newPassword);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Could not change password.",
        });
      }

      ctx.resHeaders.append("Set-Cookie", clearSessionCookieHeader());
      await logAudit({
        actorId: ctx.user.id,
        action: "auth.change_password",
        entityType: "USER",
        entityId: ctx.user.id,
        description: `${ctx.user.fullName} changed their password.`,
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  /** Update your own profile details (name shown across the app, contact info). */
  updateProfile: authedProcedure
    .input(
      z.object({
        fullName: z.string().min(3, "Full name is required").max(160),
        email: z.string().email("Enter a valid email").max(160).or(z.literal("")).nullable(),
        phone: z.string().max(40).nullable(),
        avatarUrl: z.string().max(500).nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db
        .update(users)
        .set({
          fullName: input.fullName,
          email: input.email || null,
          phone: input.phone,
          avatarUrl: input.avatarUrl,
        })
        .where(eq(users.id, ctx.user.id));

      await logAudit({
        actorId: ctx.user.id,
        action: "auth.update_profile",
        entityType: "USER",
        entityId: ctx.user.id,
        description: `${input.fullName} updated their profile.`,
        afterData: { fullName: input.fullName, email: input.email, phone: input.phone },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),
});
