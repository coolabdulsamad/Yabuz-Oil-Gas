import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { aiConversations, aiMessages } from "@db/schema";
import {
  answerBusinessQuestion,
  getAiSettings,
  polishWithLlm,
  type EntityRef,
} from "../services/ai.service";

/**
 * YABUZ OIL & GAS — AI assistant router
 * Each staff member has private conversations with the assistant. Answers are
 * computed by the deterministic data engine (live DB facts, permission-aware)
 * and optionally polished by an LLM when an API key is configured in
 * Settings → Integrations. Assistant messages embed their entity references
 * in a trailing <!--refs:[...]--> block that the frontend parses & strips.
 */

const REFS_BLOCK = (refs: EntityRef[]) => `\n\n<!--refs:${JSON.stringify(refs)}-->`;

async function requireOwnedConversation(db: ReturnType<typeof getDb>, id: number, userId: number) {
  const convo = (
    await db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1)
  )[0];
  if (!convo || convo.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  }
  return convo;
}

export const aiRouter = createRouter({
  /** My AI conversations, newest first, with a preview of the last exchange. */
  conversations: permissionProcedure("ai.use").query(async ({ ctx }) => {
    const db = getDb();
    const convos = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, ctx.user.id))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50);

    const result = [];
    for (const c of convos) {
      const last = (
        await db
          .select()
          .from(aiMessages)
          .where(eq(aiMessages.conversationId, c.id))
          .orderBy(desc(aiMessages.id))
          .limit(1)
      )[0];
      result.push({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        preview: last ? last.content.replace(/\n\n<!--refs:[\s\S]*?-->$/, "").slice(0, 80) : null,
      });
    }
    return result;
  }),

  messages: permissionProcedure("ai.use")
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      await requireOwnedConversation(db, input.conversationId, ctx.user.id);
      const rows = await db
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, input.conversationId))
        .orderBy(asc(aiMessages.id))
        .limit(200);
      return rows.map((m) => {
        const refsMatch = m.content.match(/\n\n<!--refs:([\s\S]*?)-->$/);
        let references: EntityRef[] = [];
        if (refsMatch) {
          try {
            references = JSON.parse(refsMatch[1]) as EntityRef[];
          } catch {
            references = [];
          }
        }
        return {
          id: m.id,
          role: m.role,
          content: m.content.replace(/\n\n<!--refs:[\s\S]*?-->$/, ""),
          references,
          createdAt: m.createdAt,
        };
      });
    }),

  /** Ask a question — creates the conversation on first use. */
  ask: permissionProcedure("ai.use")
    .input(
      z.object({
        conversationId: z.number().optional(),
        question: z.string().min(1, "Type a question first").max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const cfg = await getAiSettings();
      if (!cfg.enabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The AI assistant is disabled. An admin can enable it in Settings → Integrations.",
        });
      }

      const question = input.question.trim();

      // find or create the conversation
      let conversationId = input.conversationId ?? 0;
      if (conversationId) {
        await requireOwnedConversation(db, conversationId, ctx.user.id);
      } else {
        const title = question.length > 70 ? `${question.slice(0, 67)}…` : question;
        const [{ id }] = await db
          .insert(aiConversations)
          .values({ userId: ctx.user.id, title })
          .$returningId();
        conversationId = id;
      }

      // store the user message
      await db.insert(aiMessages).values({ conversationId, role: "USER", content: question });

      // recent history for the optional LLM layer
      const historyRows = await db
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId))
        .orderBy(desc(aiMessages.id))
        .limit(8);
      const history = historyRows
        .reverse()
        .filter((m) => m.role !== "SYSTEM")
        .map((m) => ({ role: m.role as "USER" | "ASSISTANT", content: m.content }));

      // deterministic answer (always works, always factual)
      const deterministic = await answerBusinessQuestion(question, {
        id: ctx.user.id,
        fullName: ctx.user.fullName,
        role: ctx.user.role,
        permissions: ctx.permissions,
      });

      // optional LLM polish — graceful fallback on any failure
      const polished = await polishWithLlm(question, deterministic, history.slice(0, -1), cfg);
      const answer = polished ?? deterministic.answer;

      const [{ id: messageId }] = await db
        .insert(aiMessages)
        .values({
          conversationId,
          role: "ASSISTANT",
          content: answer + REFS_BLOCK(deterministic.references),
        })
        .$returningId();

      await db
        .update(aiConversations)
        .set({ updatedAt: new Date() })
        .where(eq(aiConversations.id, conversationId));

      return {
        conversationId,
        messageId,
        answer,
        references: deterministic.references,
        llmEnhanced: polished !== null,
      };
    }),

  rename: permissionProcedure("ai.use")
    .input(z.object({ id: z.number(), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireOwnedConversation(db, input.id, ctx.user.id);
      await db.update(aiConversations).set({ title: input.title.trim() }).where(eq(aiConversations.id, input.id));
      return { ok: true };
    }),

  remove: permissionProcedure("ai.use")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireOwnedConversation(db, input.id, ctx.user.id);
      await db.delete(aiConversations).where(eq(aiConversations.id, input.id));
      return { ok: true };
    }),

  /** Whether the optional LLM layer is configured (for the UI badge). */
  status: permissionProcedure("ai.use").query(async () => {
    const cfg = await getAiSettings();
    return { enabled: cfg.enabled, llmConfigured: !!cfg.apiKey, model: cfg.apiKey ? cfg.model : null };
  }),
});
