import { TRPCError } from "@trpc/server";
import { publicQuery } from "./middleware";

/**
 * YABUZ OIL & GAS — procedure layer
 * Builds on the scaffold's publicQuery without touching framework files.
 *
 *   authedProcedure          → requires a logged-in staff member
 *   permissionProcedure(key) → requires a specific permission key
 *   anyPermissionProcedure() → requires ANY ONE of the given keys
 */

export const authedProcedure = publicQuery.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in to continue." });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      permissions: ctx.permissions,
    },
  });
});

export function permissionProcedure(permissionKey: string) {
  return authedProcedure.use(({ ctx, next }) => {
    if (!ctx.permissions.has(permissionKey)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You don't have permission for this action (${permissionKey}).`,
      });
    }
    return next({ ctx });
  });
}

/** Requires ANY ONE of the given permission keys. */
export function anyPermissionProcedure(permissionKeys: string[]) {
  return authedProcedure.use(({ ctx, next }) => {
    if (!permissionKeys.some((k) => ctx.permissions.has(k))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You don't have permission for this action (${permissionKeys.join(" / ")}).`,
      });
    }
    return next({ ctx });
  });
}
