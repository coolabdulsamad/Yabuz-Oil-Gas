import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { notifications } from "@db/schema";

/**
 * YABUZ OIL & GAS — notifications router
 * The header bell feed: latest items, unread count, mark read / mark all.
 * Every authenticated user sees only their own notifications.
 */

export const notificationsRouter = createRouter({
  /** Latest 25 notifications for the caller. */
  list: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.user.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(25);
    return { items };
  }),

  /** Unread badge count (polled by the header bell). */
  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.isRead, false)));
    return { count: row?.value ?? 0 };
  }),

  markRead: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { ok: true as const };
    }),

  markAllRead: authedProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, ctx.user.id));
    return { ok: true as const };
  }),
});
