import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permissionProcedure } from "../trpc";
import { getDb } from "../queries/connection";
import { approvalFlows, approvalRequests, approvalRequestSteps, users } from "@db/schema";
import { APPROVAL_FLOW_ENTITIES, APPROVAL_REQUEST_STATUSES } from "@contracts/constants";
import { logAudit, requestMeta } from "../services/audit.service";
import {
  actOnRequest,
  CHAIN_ROLES,
  getFlowSteps,
  getRequestWithSteps,
} from "../services/approvals.service";

/**
 * YABUZ OIL & GAS — approval inbox & workflow configuration
 * pendingForMe: what is waiting on the caller's role right now
 * myRequests:   what the caller submitted
 * all:          oversight for admins (approvals.view_all)
 * flows/setFlow: the configurable chains (settings.workflow)
 */

async function loadUserNames(ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<number, string>();
  const rows = await getDb()
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((u) => [u.id, u.name]));
}

export const approvalsRouter = createRouter({
  /** Requests currently waiting on the caller (their role matches the active step). */
  pendingForMe: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rolesToMatch = ctx.user.role === "SUPER_ADMIN" ? [...CHAIN_ROLES] : [ctx.user.role];
    const steps = await db
      .select({
        requestId: approvalRequestSteps.requestId,
        stepOrder: approvalRequestSteps.stepOrder,
      })
      .from(approvalRequestSteps)
      .where(and(eq(approvalRequestSteps.status, "PENDING"), inArray(approvalRequestSteps.role, rolesToMatch)));
    if (steps.length === 0) return [];
    const rows = await db
      .select()
      .from(approvalRequests)
      .where(
        and(
          inArray(approvalRequests.id, steps.map((s) => s.requestId)),
          eq(approvalRequests.status, "PENDING"),
        ),
      )
      .orderBy(desc(approvalRequests.createdAt))
      .limit(200);
    // Never list the caller's own requests — self-review is not allowed.
    const mine = rows.filter(
      (r) => r.requesterId !== ctx.user.id && steps.some((s) => s.requestId === r.id && s.stepOrder === r.currentStep),
    );
    const nameById = await loadUserNames(mine.map((r) => r.requesterId));
    return mine.map((r) => ({ ...r, requesterName: nameById.get(r.requesterId) ?? null }));
  }),

  /** Requests raised by the caller. */
  myRequests: authedProcedure
    .input(z.object({ status: z.enum(APPROVAL_REQUEST_STATUSES).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conds = [eq(approvalRequests.requesterId, ctx.user.id)];
      if (input?.status) conds.push(eq(approvalRequests.status, input.status));
      return db.select().from(approvalRequests).where(and(...conds)).orderBy(desc(approvalRequests.createdAt)).limit(200);
    }),

  /** All requests — oversight for admins / workflow managers. */
  all: permissionProcedure("approvals.view_all")
    .input(z.object({ status: z.enum(APPROVAL_REQUEST_STATUSES).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(input?.status ? eq(approvalRequests.status, input.status) : undefined)
        .orderBy(desc(approvalRequests.createdAt))
        .limit(300);
      const nameById = await loadUserNames(rows.map((r) => r.requesterId));
      return rows.map((r) => ({ ...r, requesterName: nameById.get(r.requesterId) ?? null }));
    }),

  getById: authedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const result = await getRequestWithSteps(getDb(), input.id);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found." });
    const { steps, ...request } = result;
    const isRequester = request.requesterId === ctx.user.id;
    const activeStep = steps.find((s) => s.stepOrder === request.currentStep && s.status === "PENDING");
    const canAct =
      request.status === "PENDING" &&
      !!activeStep &&
      (activeStep.role === ctx.user.role || ctx.user.role === "SUPER_ADMIN") &&
      request.requesterId !== ctx.user.id;
    const canSee =
      isRequester ||
      !!activeStep ||
      ctx.user.role === "SUPER_ADMIN" ||
      ctx.permissions.has("approvals.view_all");
    if (!canSee) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this request." });
    }
    const nameById = await loadUserNames([
      request.requesterId,
      ...steps.map((s) => s.reviewerId).filter((v): v is number => v !== null),
    ]);
    return {
      request: { ...request, requesterName: nameById.get(request.requesterId) ?? null },
      steps: steps.map((s) => ({ ...s, reviewerName: s.reviewerId ? (nameById.get(s.reviewerId) ?? null) : null })),
      canAct,
      isRequester,
    };
  }),

  act: authedProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        action: z.enum(["APPROVE", "REJECT"]),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === "REJECT" && !input.note?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required when rejecting." });
      }
      const result = await actOnRequest(getDb(), {
        requestId: input.requestId,
        reviewerId: ctx.user.id,
        reviewerRole: ctx.user.role,
        action: input.action,
        note: input.note?.trim(),
      });
      const req = result.request;
      await logAudit({
        actorId: ctx.user.id,
        action:
          input.action === "REJECT"
            ? "approval.rejected"
            : result.status === "APPROVED"
              ? "approval.approved"
              : "approval.step_approved",
        entityType: "APPROVAL",
        entityId: input.requestId,
        description:
          input.action === "APPROVE"
            ? result.status === "APPROVED"
              ? `Final approval: ${req.requestType} — ${req.summary}`
              : `Approved step ${req.currentStep} of ${req.totalSteps}: ${req.requestType} — ${req.summary}`
            : `Rejected: ${req.requestType} — ${req.summary}${input.note ? ` (${input.note})` : ""}`,
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, requestStatus: result.status };
    }),

  /** Configured flows — any staff member may read them to understand routing. */
  flows: authedProcedure.query(async () => {
    return getDb().select().from(approvalFlows);
  }),

  setFlow: permissionProcedure("settings.workflow")
    .input(
      z.object({
        entityType: z.enum(APPROVAL_FLOW_ENTITIES),
        /** Ordered chain of reviewer roles. Empty = no approval needed (direct effect). */
        steps: z.array(z.enum(CHAIN_ROLES)).max(4),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [existing] = await db.select().from(approvalFlows).where(eq(approvalFlows.entityType, input.entityType)).limit(1);
      const before = existing ? { steps: existing.steps, isActive: existing.isActive } : null;
      if (existing) {
        await db
          .update(approvalFlows)
          .set({ steps: input.steps, isActive: input.isActive, updatedBy: ctx.user.id })
          .where(eq(approvalFlows.id, existing.id));
      } else {
        await db.insert(approvalFlows).values({
          entityType: input.entityType,
          steps: input.steps,
          isActive: input.isActive,
          updatedBy: ctx.user.id,
        });
      }
      await logAudit({
        actorId: ctx.user.id,
        action: "approval_flow.update",
        entityType: "APPROVAL",
        entityId: existing?.id ?? null,
        description: `Approval flow for ${input.entityType} → ${input.steps.length ? input.steps.join(" → ") : "(no approval — direct)"}${input.isActive ? "" : " [disabled]"}`,
        beforeData: before ?? undefined,
        afterData: { steps: input.steps, isActive: input.isActive },
        ...requestMeta(ctx.req),
      });
      return { ok: true as const, steps: await getFlowSteps(db, input.entityType) };
    }),
});
