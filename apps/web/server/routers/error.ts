import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  chargedProcedure,
  validateEntryOwnership,
  router,
} from "../trpc.js";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { getAiRouter } from "@/lib/ai-client";
import {
  upsertEntryOnDiagnose,
  nextReviewAtAfter,
  toEntryView,
  toQuestionView,
  toVariantGroupView,
  DAY_MS,
} from "../lib/error-book.js";

export const errorRouter = router({
  // === diagnose ===
  // chargedProcedure("ERROR_ANALYSIS") wraps debit BEFORE this body runs.
  // On non-compliance failure the middleware compensates; on
  // ComplianceRejectedError the middleware whitelists (no comp) per Plan 3
  // contract. Body returns entryId (spec UI feedback A) so the
  // ErrorAnalysisCard can deep-link to the error-book detail page.
  diagnose: chargedProcedure("ERROR_ANALYSIS")
    .input(
      z.object({
        questionId: z.string().cuid(),
        actualAnswerMd: z.string().max(5000).optional(),
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // findUniqueOrThrow: a missing question is BAD_REQUEST level — the
      // chargeMiddleware will compensate the debit because the thrown error
      // isn't on the whitelist (spec §6.5).
      const question = await ctx.db.question.findUniqueOrThrow({
        where: { id: input.questionId },
        include: {
          answer: true,
          knowledgePoints: { include: { kp: true } },
        },
      });

      // gradeLevel lives on User, not on the JWT/AccessClaims (kept off the
      // token to avoid invalidating sessions when a student updates grade).
      // One read per diagnose; acceptable cost for a 1-credit action.
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.auth.userId },
        select: { gradeLevel: true },
      });

      const aiRouter = getAiRouter(ctx.auth.userId);
      let ai;
      try {
        ai = await aiRouter.diagnoseError({
          stemMd: question.stemMd,
          correctAnswerMd: question.answer?.contentMd ?? null,
          actualAnswerMd: input.actualAnswerMd ?? null,
          studentGrade: user?.gradeLevel ?? null,
        });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "错因分析未通过合规检查",
            // cause.original preserves the upstream class so chargeMiddleware
            // can find ComplianceRejectedError through the TRPCError wrap and
            // route to the no-compensation branch.
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "错因分析失败",
          cause: { reason: "ERROR_ANALYSIS_INTERNAL", original: e },
        });
      }

      const entry = await ctx.db.$transaction((tx) =>
        upsertEntryOnDiagnose(tx, {
          userId: ctx.auth.userId,
          questionId: input.questionId,
          ai,
          debitLedgerId: ctx.debit.ledgerId,
          modelCallId: ai.modelCallId,
          actualAnswerMd: input.actualAnswerMd ?? null,
        }),
      );

      return {
        entryId: entry.id,
        rootCause: entry.rootCause,
        rootCauseReasoning: entry.rootCauseReasoning,
        suggestedKnowledgePoints: ai.suggestedKnowledgePoints,
        nextActions: ["GENERATE_VARIANTS", "REVIEW_LATER", "ASK_TUTOR"] as const,
      };
    }),

  // === list ===
  // spec §3.1 + §5.1.2: default 错题本 = ACTIVE only. ARCHIVED is "moved out
  // of the default view" — the archived page must explicitly pass
  // status: "ARCHIVED". The zod enum deliberately omits "DELETED" so any
  // client (legit or hostile) probing for deleted entries gets BAD_REQUEST,
  // never a leaked row.
  list: authedProcedure
    .input(
      z.object({
        status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        userId: ctx.auth.userId,
        status: input.status ?? "ACTIVE",
      };
      // Cursor semantics: nextCursor = popped (limit+1)-th entry's id; next
      // page's cursor query is INCLUSIVE (no skip:1) so the boundary entry
      // appears as the first row of page 2. Mirrors wallet.ledgerList; adding
      // skip:1 would drop one entry per page boundary.
      const entries = await ctx.db.errorBookEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor } } : {}),
        include: { question: { select: { id: true, stemMd: true, type: true } } },
      });
      const nextCursor =
        entries.length > input.limit ? entries.pop()!.id : null;
      return { entries: entries.map(toEntryView), nextCursor };
    }),

  // === getById ===
  // validateEntryOwnership covers all three NOT_FOUND cases (missing / cross-user
  // / DELETED) with a single ENTRY_NOT_FOUND so client UX is uniform and there's
  // no existence side-channel.
  getById: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .query(async ({ ctx }) => {
      const variantGroups = await ctx.db.variantGroup.findMany({
        where: { entryId: ctx.entry.id },
        orderBy: { createdAt: "desc" },
        include: { items: { orderBy: { position: "asc" } } },
      });
      return {
        entry: toEntryView(ctx.entry),
        question: toQuestionView(ctx.entry.question),
        variantGroups: variantGroups.map(toVariantGroupView),
      };
    }),

  // === dueForReview ===
  // spec §5.1.4 + UI feedback B: when dueToday is empty, return the
  // nextReviewAt of the nearest future ACTIVE entry so the review page can
  // render "下次复习 +Xd". When dueToday is non-empty, nextReviewAt = null
  // (frontend renders the list). When the user has no ACTIVE entries at all,
  // both are empty/null (frontend renders the "no errors to review" copy).
  dueForReview: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const userId = ctx.auth.userId;
      const dueToday = await ctx.db.errorBookEntry.findMany({
        where: { userId, status: "ACTIVE", nextReviewAt: { lte: now } },
        orderBy: { nextReviewAt: "asc" },
        take: input.limit,
        include: { question: { select: { id: true, stemMd: true, type: true } } },
      });
      let nextReviewAt: Date | null = null;
      if (dueToday.length === 0) {
        const future = await ctx.db.errorBookEntry.findFirst({
          where: { userId, status: "ACTIVE", nextReviewAt: { gt: now } },
          orderBy: { nextReviewAt: "asc" },
          select: { nextReviewAt: true },
        });
        nextReviewAt = future?.nextReviewAt ?? null;
      }
      return { dueToday: dueToday.map(toEntryView), nextReviewAt };
    }),

  // === markReviewed ===
  // Bumps the entry along the fixed 5-step interval ladder. ACTIVE-only by
  // design: ARCHIVED entries explicitly opted out of the review queue, and
  // DELETED is filtered by validateEntryOwnership.
  markReviewed: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      if (ctx.entry.status !== "ACTIVE") {
        // validateEntryOwnership accepts ACTIVE | ARCHIVED (it rejects only
        // DELETED), so the residual case here is ARCHIVED. The user has to
        // unarchive before they can mark-as-reviewed; we don't silently
        // resurrect.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "仅 ACTIVE 错题可标记已复习",
          cause: { reason: "ENTRY_NOT_ACTIVE" },
        });
      }
      const now = new Date();
      const reviewCountAfter = ctx.entry.reviewCount + 1;
      const updated = await ctx.db.errorBookEntry.update({
        where: { id: ctx.entry.id },
        data: {
          reviewCount: reviewCountAfter,
          lastReviewedAt: now,
          nextReviewAt: nextReviewAtAfter(reviewCountAfter, now),
        },
      });
      return { entry: toEntryView(updated) };
    }),

  // === archive ===
  // Toggles between ACTIVE and ARCHIVED. Idempotent: if the entry is
  // already at the target status, return without touching updatedAt. On
  // unarchive (archived: false) we set nextReviewAt = now + 1d to put the
  // entry back in the review queue at the front (not its historical
  // schedule, which could be stale by many weeks).
  archive: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const target = input.archived ? "ARCHIVED" : "ACTIVE";
      if (ctx.entry.status === target) {
        return { entry: toEntryView(ctx.entry) };
      }
      const updated = await ctx.db.errorBookEntry.update({
        where: { id: ctx.entry.id },
        data: {
          status: target,
          // Archive: remove from review queue.
          // Unarchive: seed queue at +1d (not the stale historical
          // nextReviewAt) so the user re-engages soon.
          nextReviewAt:
            target === "ARCHIVED" ? null : new Date(Date.now() + DAY_MS),
        },
      });
      return { entry: toEntryView(updated) };
    }),

  // === delete ===
  // Terminal. After this call the entry is invisible to every
  // student-facing surface (list / getById / dueForReview / markReviewed /
  // archive / variant.generateForEntry). The row stays in DB for audit and
  // to anchor the partial-unique-index "DELETED row coexists with new
  // ACTIVE row for same (user, question)" semantic — re-diagnosing the
  // same question after delete produces a brand-new entry, NOT a
  // resurrected one.
  //
  // The plan/spec calls the procedure "delete" but JS reserves that as a
  // keyword in some positions; the router key is "delete" (string literal
  // in the object) and the named export is `deleteEntry` to avoid surprises
  // for direct importers.
  delete: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.errorBookEntry.update({
        where: { id: ctx.entry.id },
        data: { status: "DELETED", nextReviewAt: null },
      });
      return { ok: true as const };
    }),
});
