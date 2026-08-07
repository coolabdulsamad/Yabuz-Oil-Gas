import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { moneyMovements } from "@db/schema";
import { MONEY_DIRECTIONS, MONEY_METHODS, MONEY_SOURCES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import { listMoneyMovements, summarizeMovements } from "../services/money.service";

/**
 * YABUZ OIL & GAS — money movements router
 * The cash & bank command center: every real-money in/out across sales
 * payments, credit repayments, deposits, expenses, salaries, loans and
 * manual "other" entries — filterable, with per-method balances.
 */

const filtersInput = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    direction: z.enum(MONEY_DIRECTIONS).optional(),
    method: z.enum(MONEY_METHODS).optional(),
    source: z.enum(MONEY_SOURCES).optional(),
    search: z.string().max(120).optional(),
  })
  .optional();

export const moneyRouter = createRouter({
  /** Unified movement history + summary cards (respects the same filters). */
  overview: permissionProcedure("money.view").input(filtersInput).query(async ({ input }) => {
    const db = getDb();
    const rows = await listMoneyMovements(db, input ?? {});
    return { rows: rows.slice(0, 500), summary: summarizeMovements(rows) };
  }),

  /** Record a manual "other" money in/out (owner capital, bank charges…). */
  createMovement: permissionProcedure("money.manage")
    .input(
      z.object({
        direction: z.enum(MONEY_DIRECTIONS),
        method: z.enum(MONEY_METHODS),
        label: z.string().trim().min(2, "Give it a short label").max(120),
        amount: z.number().positive("Amount must be greater than zero"),
        description: z.string().trim().max(2000).optional(),
        movementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const date = new Date(`${input.movementDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date." });

      const result = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(moneyMovements)
          .values({
            reference: "PENDING",
            direction: input.direction,
            method: input.method,
            label: input.label,
            amount: input.amount,
            description: input.description || null,
            movementDate: date,
            createdBy: ctx.user.id,
          })
          .$returningId();
        const reference = `MM-${String(id).padStart(6, "0")}`;
        await tx.update(moneyMovements).set({ reference }).where(eq(moneyMovements.id, id));
        return { id, reference };
      });

      await logAudit({
        actorId: ctx.user.id,
        action: "money.movement_created",
        entityType: "MONEY_MOVEMENT",
        entityId: result.id,
        description: `Recorded ${input.direction === "IN" ? "money in" : "money out"} ${result.reference} — ₦${input.amount.toLocaleString()} ${input.method.toLowerCase().replace("_", " ")} · ${input.label}.`,
        afterData: { ...input },
        ...requestMeta(ctx.req),
      });
      return result;
    }),

  /** Remove a manual entry recorded by mistake (manual entries only). */
  deleteMovement: permissionProcedure("money.manage")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db.select().from(moneyMovements).where(eq(moneyMovements.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found." });
      await db.delete(moneyMovements).where(eq(moneyMovements.id, input.id));
      await logAudit({
        actorId: ctx.user.id,
        action: "money.movement_deleted",
        entityType: "MONEY_MOVEMENT",
        entityId: input.id,
        description: `Deleted manual money entry ${row.reference} — ${row.direction} ₦${row.amount.toLocaleString()} (${row.label}).`,
        beforeData: { ...row },
        ...requestMeta(ctx.req),
      });
      return { ok: true };
    }),
});
