import { z } from "zod";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { auditLogs } from "@db/schema";

/**
 * YABUZ OIL & GAS — audit log router (audit.view)
 * Read-only inspection of the full activity trail: who did what, when, on
 * which entity, with before → after snapshots, IP and device. Filterable by
 * actor, action, entity type, text and date range.
 */

const listInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(5).max(100).default(25),
  search: z.string().max(200).optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(50).optional(),
  actorId: z.number().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function fromDate(s: string) {
  return new Date(`${s}T00:00:00.000Z`);
}
function toDate(s: string) {
  return new Date(`${s}T23:59:59.999Z`);
}

/** Action families for the filter dropdown (prefix before the dot). */
export const auditRouter = createRouter({
  list: permissionProcedure("audit.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input.action) conds.push(eq(auditLogs.action, input.action));
      if (input.entityType) conds.push(eq(auditLogs.entityType, input.entityType));
      if (input.actorId) conds.push(eq(auditLogs.actorId, input.actorId));
      if (input.dateFrom) conds.push(gte(auditLogs.createdAt, fromDate(input.dateFrom)));
      if (input.dateTo) conds.push(lte(auditLogs.createdAt, toDate(input.dateTo)));
      if (input.search) {
        const q = `%${input.search.trim()}%`;
        conds.push(
          or(
            like(auditLogs.description, q),
            like(auditLogs.actorName, q),
            like(auditLogs.action, q),
            like(auditLogs.entityId, q),
          ),
        );
      }
      const where = conds.length ? and(...conds) : undefined;

      const [totalRow] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(where);
      const total = Number(totalRow?.n ?? 0);
      const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, pageCount);

      const items = await db
        .select({
          id: auditLogs.id,
          actorId: auditLogs.actorId,
          actorName: auditLogs.actorName,
          actorRole: auditLogs.actorRole,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          description: auditLogs.description,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.id))
        .limit(input.pageSize)
        .offset((page - 1) * input.pageSize);

      return { items, total, page, pageCount, pageSize: input.pageSize };
    }),

  /** Distinct values for the filter dropdowns + headline stats. */
  meta: permissionProcedure("audit.view").query(async () => {
    const db = getDb();
    const actions = await db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(auditLogs.action);
    const entityTypes = await db
      .selectDistinct({ entityType: auditLogs.entityType })
      .from(auditLogs)
      .orderBy(auditLogs.entityType);
    const actors = await db
      .selectDistinct({ actorId: auditLogs.actorId, actorName: auditLogs.actorName })
      .from(auditLogs)
      .orderBy(auditLogs.actorName);

    const [stats] = await db
      .select({
        total: sql<number>`COUNT(*)`,
        // "today" by the DATABASE clock — audit timestamps are DB-generated,
        // and the app server clock can drift from it.
        today: sql<number>`COALESCE(SUM(CASE WHEN DATE(${auditLogs.createdAt}) = CURDATE() THEN 1 ELSE 0 END), 0)`,
        failedLogins: sql<number>`COALESCE(SUM(CASE WHEN ${auditLogs.action} = 'auth.login_failed' THEN 1 ELSE 0 END), 0)`,
        actors: sql<number>`COUNT(DISTINCT ${auditLogs.actorName})`,
      })
      .from(auditLogs);

    return {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType),
      actors: actors
        .filter((a) => a.actorId !== null)
        .map((a) => ({ id: a.actorId as number, name: a.actorName })),
      stats: {
        total: Number(stats?.total ?? 0),
        today: Number(stats?.today ?? 0),
        failedLogins: Number(stats?.failedLogins ?? 0),
        actors: Number(stats?.actors ?? 0),
      },
    };
  }),

  getById: permissionProcedure("audit.view")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const row = (
        await db.select().from(auditLogs).where(eq(auditLogs.id, input.id)).limit(1)
      )[0];
      if (!row) return null;
      return row;
    }),
});
