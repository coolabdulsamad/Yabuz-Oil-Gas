import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, desc, eq, gt, like, ne, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import {
  chatConversations,
  chatMessages,
  chatParticipants,
  customers,
  expenses,
  payments,
  products,
  purchases,
  sales,
  users,
} from "@db/schema";
import { MESSAGE_REFERENCE_TYPES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";

/**
 * YABUZ OIL & GAS — team chat router
 * Direct + group conversations between staff, with entity reference cards
 * (product / sale / customer / payment / purchase / stock / expense) that
 * deep-link into the app. A default "Yabuz Team" group always exists and
 * automatically includes every active staff member.
 *
 * Individual message sends are intentionally NOT audit-logged (chat volume
 * would swamp the trail); structural events (group creation, message
 * deletion) are.
 */

const TEAM_GROUP_NAME = "Yabuz Team";

/** Make sure the all-staff group exists and contains every ACTIVE user. */
async function ensureTeamGroup(db: ReturnType<typeof getDb>) {
  let group = (
    await db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.type, "GROUP"), eq(chatConversations.name, TEAM_GROUP_NAME)))
      .limit(1)
  )[0];

  if (!group) {
    const [{ id }] = await db
      .insert(chatConversations)
      .values({ type: "GROUP", name: TEAM_GROUP_NAME })
      .$returningId();
    group = (await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1))[0];
  }

  const activeUsers = await db.select({ id: users.id }).from(users).where(eq(users.status, "ACTIVE"));
  const existing = await db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(eq(chatParticipants.conversationId, group.id));
  const present = new Set(existing.map((r) => r.userId));
  const missing = activeUsers.filter((u) => !present.has(u.id));
  if (missing.length > 0) {
    await db.insert(chatParticipants).values(missing.map((u) => ({ conversationId: group.id, userId: u.id })));
  }
  return group;
}

async function requireMembership(db: ReturnType<typeof getDb>, conversationId: number, userId: number) {
  const convo = (
    await db.select().from(chatConversations).where(eq(chatConversations.id, conversationId)).limit(1)
  )[0];
  if (!convo) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  const member = (
    await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, userId)))
      .limit(1)
  )[0];
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You're not a member of this conversation." });
  }
  return { convo, member };
}

/** Resolve the canonical label for an entity reference (never trust the client). */
async function resolveReference(
  db: ReturnType<typeof getDb>,
  type: (typeof MESSAGE_REFERENCE_TYPES)[number],
  id: number,
  perms: Set<string>,
): Promise<string> {
  const need = (key: string) => {
    if (!perms.has(key)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `You can't reference this without the ${key} permission.` });
    }
  };
  switch (type) {
    case "PRODUCT":
    case "STOCK": {
      need("products.view");
      const p = (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
      return p.name;
    }
    case "CUSTOMER": {
      need("customers.view");
      const c = (await db.select().from(customers).where(eq(customers.id, id)).limit(1))[0];
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
      return `${c.fullName} (${c.code})`;
    }
    case "SALE": {
      need("sales.view");
      const s = (await db.select().from(sales).where(eq(sales.id, id)).limit(1))[0];
      if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
      return s.orderNo;
    }
    case "PAYMENT": {
      need("payments.view");
      const p = (await db.select().from(payments).where(eq(payments.id, id)).limit(1))[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
      return p.reference;
    }
    case "PURCHASE": {
      need("inventory.manage_purchases");
      const p = (await db.select().from(purchases).where(eq(purchases.id, id)).limit(1))[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found." });
      return p.reference;
    }
    case "EXPENSE": {
      need("expenses.view");
      const e = (await db.select().from(expenses).where(eq(expenses.id, id)).limit(1))[0];
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found." });
      return e.reference;
    }
  }
}

export const chatRouter = createRouter({
  /* ------------------------------ directory ------------------------------ */

  /** Staff list for starting new chats (any chat user can see colleagues). */
  staff: permissionProcedure("chat.use").query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select({ id: users.id, fullName: users.fullName, role: users.role, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.status, "ACTIVE"), ne(users.id, ctx.user.id)))
      .orderBy(asc(users.fullName));
  }),

  /** My conversations with last message + unread count. Auto-creates the team group. */
  conversations: permissionProcedure("chat.use").query(async ({ ctx }) => {
    const db = getDb();
    await ensureTeamGroup(db);

    const myParticipation = await db
      .select()
      .from(chatParticipants)
      .where(eq(chatParticipants.userId, ctx.user.id));
    if (myParticipation.length === 0) return [];

    const convoIds = myParticipation.map((p) => p.conversationId);
    const convos = await db
      .select()
      .from(chatConversations)
      .where(sql`${chatConversations.id} IN (${sql.join(convoIds.map((id) => sql`${id}`), sql`, `)})`);

    const allParticipants = await db
      .select({
        conversationId: chatParticipants.conversationId,
        userId: chatParticipants.userId,
        fullName: users.fullName,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(chatParticipants)
      .innerJoin(users, eq(chatParticipants.userId, users.id))
      .where(sql`${chatParticipants.conversationId} IN (${sql.join(convoIds.map((id) => sql`${id}`), sql`, `)})`);

    const lastRead = new Map(myParticipation.map((p) => [p.conversationId, p.lastReadMessageId ?? 0]));

    const result = [];
    for (const c of convos) {
      const msgs = await db
        .select({
          id: chatMessages.id,
          body: chatMessages.body,
          senderId: chatMessages.senderId,
          referenceType: chatMessages.referenceType,
          referenceLabel: chatMessages.referenceLabel,
          createdAt: chatMessages.createdAt,
          senderName: users.fullName,
        })
        .from(chatMessages)
        .innerJoin(users, eq(chatMessages.senderId, users.id))
        .where(and(eq(chatMessages.conversationId, c.id), sql`${chatMessages.deletedAt} IS NULL`))
        .orderBy(desc(chatMessages.id))
        .limit(50);

      const last = msgs[0] ?? null;
      const readUpTo = lastRead.get(c.id) ?? 0;
      const unread = msgs.filter((m) => m.id > readUpTo && m.senderId !== ctx.user.id).length;

      const members = allParticipants.filter((p) => p.conversationId === c.id);
      const others = members.filter((m) => m.userId !== ctx.user.id);
      const title = c.type === "GROUP" ? (c.name ?? "Group") : (others[0]?.fullName ?? "Conversation");

      result.push({
        id: c.id,
        type: c.type,
        title,
        isTeamGroup: c.type === "GROUP" && c.name === TEAM_GROUP_NAME,
        members: members.map((m) => ({ id: m.userId, fullName: m.fullName, role: m.role, avatarUrl: m.avatarUrl })),
        lastMessage: last
          ? {
              id: last.id,
              preview: last.body?.slice(0, 80) || (last.referenceLabel ? `📎 ${last.referenceLabel}` : ""),
              senderName: last.senderName,
              createdAt: last.createdAt,
            }
          : null,
        unread,
      });
    }

    return result.sort((a, b) => {
      const ta = a.lastMessage?.createdAt?.getTime() ?? 0;
      const tb = b.lastMessage?.createdAt?.getTime() ?? 0;
      return tb - ta;
    });
  }),

  /* ------------------------------ creation ------------------------------ */

  createDirect: permissionProcedure("chat.use")
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't start a chat with yourself." });
      }
      const other = (
        await db.select().from(users).where(and(eq(users.id, input.userId), eq(users.status, "ACTIVE"))).limit(1)
      )[0];
      if (!other) throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });

      // existing DIRECT conversation shared by exactly these two?
      const myConvos = await db.select().from(chatParticipants).where(eq(chatParticipants.userId, ctx.user.id));
      for (const mc of myConvos) {
        const parts = await db
          .select()
          .from(chatParticipants)
          .where(eq(chatParticipants.conversationId, mc.conversationId));
        if (parts.length !== 2 || !parts.some((p) => p.userId === input.userId)) continue;
        const convo = (
          await db.select().from(chatConversations).where(eq(chatConversations.id, mc.conversationId)).limit(1)
        )[0];
        if (convo?.type === "DIRECT") return { conversationId: convo.id, created: false };
      }

      const [{ id }] = await db.insert(chatConversations).values({ type: "DIRECT", createdBy: ctx.user.id }).$returningId();
      await db.insert(chatParticipants).values([
        { conversationId: id, userId: ctx.user.id },
        { conversationId: id, userId: input.userId },
      ]);
      return { conversationId: id, created: true };
    }),

  createGroup: permissionProcedure("chat.use")
    .input(z.object({ name: z.string().min(2).max(160), memberIds: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [{ id }] = await db
        .insert(chatConversations)
        .values({ type: "GROUP", name: input.name.trim(), createdBy: ctx.user.id })
        .$returningId();
      const memberSet = new Set([ctx.user.id, ...input.memberIds]);
      await db.insert(chatParticipants).values([...memberSet].map((userId) => ({ conversationId: id, userId })));
      await logAudit({
        actorId: ctx.user.id,
        action: "chat.group_created",
        entityType: "CHAT",
        entityId: id,
        description: `Created group chat "${input.name.trim()}" with ${memberSet.size} members.`,
        afterData: { name: input.name.trim(), members: [...memberSet] },
        ...requestMeta(ctx.req),
      });
      return { conversationId: id, created: true };
    }),

  /* ------------------------------ messages ------------------------------ */

  messages: permissionProcedure("chat.use")
    .input(
      z.object({
        conversationId: z.number(),
        beforeId: z.number().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      await requireMembership(db, input.conversationId, ctx.user.id);

      const conds = [eq(chatMessages.conversationId, input.conversationId)];
      if (input.beforeId) conds.push(sql`${chatMessages.id} < ${input.beforeId}`);

      const rows = await db
        .select({
          id: chatMessages.id,
          body: chatMessages.body,
          senderId: chatMessages.senderId,
          referenceType: chatMessages.referenceType,
          referenceId: chatMessages.referenceId,
          referenceLabel: chatMessages.referenceLabel,
          createdAt: chatMessages.createdAt,
          deletedAt: chatMessages.deletedAt,
          senderName: users.fullName,
          senderRole: users.role,
          senderAvatar: users.avatarUrl,
        })
        .from(chatMessages)
        .innerJoin(users, eq(chatMessages.senderId, users.id))
        .where(and(...conds))
        .orderBy(desc(chatMessages.id))
        .limit(input.limit);

      return rows.reverse().map((m) => ({
        ...m,
        body: m.deletedAt ? null : m.body,
        deleted: !!m.deletedAt,
        mine: m.senderId === ctx.user.id,
      }));
    }),

  send: permissionProcedure("chat.use")
    .input(
      z.object({
        conversationId: z.number(),
        body: z.string().max(4000).optional(),
        referenceType: z.enum(MESSAGE_REFERENCE_TYPES).optional(),
        referenceId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireMembership(db, input.conversationId, ctx.user.id);

      const body = input.body?.trim() ?? "";
      if (!body && !input.referenceType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Type a message or attach a reference." });
      }
      if ((input.referenceType && !input.referenceId) || (!input.referenceType && input.referenceId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reference type and id must come together." });
      }

      let referenceLabel: string | null = null;
      if (input.referenceType && input.referenceId) {
        referenceLabel = await resolveReference(db, input.referenceType, input.referenceId, ctx.permissions);
      }

      const [{ id }] = await db
        .insert(chatMessages)
        .values({
          conversationId: input.conversationId,
          senderId: ctx.user.id,
          body: body || null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          referenceLabel,
        })
        .$returningId();

      // sender has obviously read up to their own message
      await db
        .update(chatParticipants)
        .set({ lastReadMessageId: id })
        .where(and(eq(chatParticipants.conversationId, input.conversationId), eq(chatParticipants.userId, ctx.user.id)));

      return { messageId: id, referenceLabel };
    }),

  deleteMessage: permissionProcedure("chat.use")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const msg = (
        await db.select().from(chatMessages).where(eq(chatMessages.id, input.id)).limit(1)
      )[0];
      if (!msg || msg.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
      const canModerate = ctx.permissions.has("users.manage");
      if (msg.senderId !== ctx.user.id && !canModerate) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own messages." });
      }
      await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, input.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "chat.message_deleted",
        entityType: "CHAT",
        entityId: input.id,
        description: `Deleted a chat message in conversation #${msg.conversationId}.`,
        beforeData: { body: msg.body, referenceLabel: msg.referenceLabel },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),

  markRead: permissionProcedure("chat.use")
    .input(z.object({ conversationId: z.number(), messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { member } = await requireMembership(db, input.conversationId, ctx.user.id);
      if ((member.lastReadMessageId ?? 0) < input.messageId) {
        await db
          .update(chatParticipants)
          .set({ lastReadMessageId: input.messageId })
          .where(
            and(
              eq(chatParticipants.conversationId, input.conversationId),
              eq(chatParticipants.userId, ctx.user.id),
            ),
          );
      }
      return { ok: true };
    }),

  /* ------------------------------ entity picker ------------------------------ */

  /** Search products / customers / sales for the composer @-picker. */
  searchEntities: permissionProcedure("chat.use")
    .input(z.object({ query: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const q = `%${input.query.trim()}%`;
      const out: {
        products: { id: number; label: string; sub: string }[];
        customers: { id: number; label: string; sub: string }[];
        sales: { id: number; label: string; sub: string }[];
      } = { products: [], customers: [], sales: [] };

      if (ctx.permissions.has("products.view") || ctx.permissions.has("inventory.view")) {
        const rows = await db
          .select()
          .from(products)
          .where(and(eq(products.status, "ACTIVE"), or(like(products.name, q), like(products.sku, q))))
          .orderBy(asc(products.name))
          .limit(6);
        out.products = rows.map((p) => ({
          id: p.id,
          label: p.name,
          sub: `${p.sku} · stock ${Number(p.currentStock)}`,
        }));
      }

      if (ctx.permissions.has("customers.view")) {
        const rows = await db
          .select()
          .from(customers)
          .where(or(like(customers.fullName, q), like(customers.businessName, q), like(customers.code, q)))
          .orderBy(asc(customers.fullName))
          .limit(6);
        out.customers = rows.map((c) => ({ id: c.id, label: c.fullName, sub: c.code }));
      }

      if (ctx.permissions.has("sales.view")) {
        const conds = [like(sales.orderNo, q)];
        if (!ctx.permissions.has("sales.view_all")) conds.push(eq(sales.salesRepId, ctx.user.id));
        const rows = await db
          .select()
          .from(sales)
          .where(and(...conds))
          .orderBy(desc(sales.id))
          .limit(6);
        out.sales = rows.map((s) => ({
          id: s.id,
          label: s.orderNo,
          sub: `${s.status.replace(/_/g, " ")} · ₦${Number(s.grandTotal).toLocaleString()}`,
        }));
      }

      return out;
    }),
});
