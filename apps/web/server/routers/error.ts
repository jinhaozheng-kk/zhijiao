import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  consentGatedProcedure,
  chargeMiddleware,
  validateEntryOwnership,
  validateQuestionAccess,
  router,
} from "../trpc.js";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { redactPii } from "@zhijiao/domain";
import { getAiRouter } from "@/lib/ai-client";
import {
  upsertEntryOnDiagnose,
  nextReviewAtAfter,
  toEntryView,
  toQuestionView,
  toVariantGroupView,
  DAY_MS,
} from "../lib/error-book.js";
import { reconcileHintsSync } from "../lib/kp-reconcile.js";
import { logger } from "../logger.js";

export const errorRouter = router({
  // === diagnose ===
  // Plan 8 hotfix (P1 from review): explicit chain so validateQuestionAccess
  // runs BEFORE chargeMiddleware. Pre-Plan-8 every Question was PUBLISHED so
  // bare findUniqueOrThrow was fine. Plan 8 introduced USER_ADHOC rows owned
  // by createdByUserId — without a gate, user A could send user B's
  // USER_ADHOC questionId, get the stem read out and write an entry against
  // A. validateQuestionAccess enforces "USER_ADHOC: owner only" before the
  // DEBIT row is written, and injects ctx.question so we don't re-query.
  //
  // On non-compliance failure (body throws) chargeMiddleware compensates;
  // on ComplianceRejectedError chargeMiddleware whitelists (no comp) per
  // Plan 3 contract. Body returns entryId (spec UI feedback A) so the
  // ErrorAnalysisCard can deep-link to the error-book detail page.
  diagnose: authedProcedure
    .use(validateQuestionAccess)
    .use(chargeMiddleware("ERROR_ANALYSIS"))
    .input(
      z.object({
        questionId: z.string().cuid(),
        actualAnswerMd: z.string().max(5000).optional(),
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ctx.question injected by validateQuestionAccess; includes answer +
      // knowledgePoints. Saves a round trip vs. re-querying.
      const question = ctx.question;

      // gradeLevel lives on User, not on the JWT/AccessClaims (kept off the
      // token to avoid invalidating sessions when a student updates grade).
      // One read per diagnose; acceptable cost for a 1-credit action.
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.auth.userId },
        select: { gradeLevel: true },
      });

      // Plan 14c：学生自由作答在喂 AI + 落库前脱敏（手机号/身份证）。脱敏一次复用，
      // 确保模型与 ErrorBookEntry.actualAnswerMd 都拿不到原始 PII。
      const redactedActualAnswer = input.actualAnswerMd
        ? redactPii(input.actualAnswerMd).redacted
        : null;

      const aiRouter = getAiRouter(ctx.auth.userId);
      let ai;
      try {
        ai = await aiRouter.diagnoseError({
          stemMd: question.stemMd,
          correctAnswerMd: question.answer?.contentMd ?? null,
          actualAnswerMd: redactedActualAnswer,
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

      // Plan 4 hotfix: upsertEntryOnDiagnose now takes the bare PrismaClient,
      // not a TransactionClient — the race-detect re-read after P2002 cannot
      // run inside an aborted tx (Postgres 25P02). The partial unique idx at
      // DB level still guarantees at-most-1 ACTIVE/ARCHIVED entry per
      // (userId, questionId).
      const entry = await upsertEntryOnDiagnose(ctx.db, {
        userId: ctx.auth.userId,
        questionId: input.questionId,
        ai,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId: ai.modelCallId,
        actualAnswerMd: redactedActualAnswer,
      });

      // Plan 9: AI 给的 suggestedKnowledgePoints 走 reconcile（exact/alias sync 命中
      // 即 LINKED QuestionKPLink；miss 进 UNMATCHED 等异步 LLM）。await + try/catch +
      // 必须**不**破坏主流程（红线 #1）—— diagnose 已经成功，KP reconcile 是后台增强。
      // 注：sourceRefId 是 entry.id 不是 diagnoseLedgerId（spec §6.2 / 红线 #7）。
      try {
        await reconcileHintsSync(ctx.db, {
          questionId: input.questionId,
          hints: ai.suggestedKnowledgePoints,
          source: "ERROR_ANALYSIS",
          sourceRefType: "ERROR_BOOK_ENTRY",
          sourceRefId: entry.id,
        });
      } catch (e) {
        logger.warn({
          event: "kp_reconcile_sync_failed",
          source: "ERROR_ANALYSIS",
          entryId: entry.id,
          err: String(e),
        });
      }

      return {
        entryId: entry.id,
        rootCause: entry.rootCause,
        rootCauseReasoning: entry.rootCauseReasoning,
        suggestedKnowledgePoints: ai.suggestedKnowledgePoints,
        nextActions: ["GENERATE_VARIANTS", "REVIEW_LATER", "ASK_TUTOR"] as const,
      };
    }),

  // === findEntryForQuestion ===
  // Plan 8 hotfix (P2 from review): TutorForm 接 ErrorAnalysisCard 后，同一题反复
  // 提交会让卡片始终从空 CTA 起步；点 "加入错题本并分析错因" 又走一次 chargedProcedure
  // = 重复扣费 + AI 调用浪费。提供一个只读 query 让卡片在 mount 时判断：当前用户对此
  // questionId 是否已有 ACTIVE/ARCHIVED entry。
  //
  // 隐私：questionId 本身是允许猜的（不是 entry id），但本 query 只返回 *当前用户*
  // 的 entry，跨用户无侧信道 —— attacker 拿到 questionId 顶多知道"我自己有没有诊断
  // 过这道公共题"，对 USER_ADHOC 因为 createdByUserId 守门（validateQuestionAccess
  // 已经管了 diagnose / variant），这里只看当前用户自己的 entry 即可。
  //
  // DELETED 不返回：与 partial unique idx 一致（DELETED 终态、与新 ACTIVE 共存），
  // 卡片应把 DELETED 后的同题视作"还没诊断"，重新走付费 CTA。
  findEntryForQuestion: consentGatedProcedure
    .input(z.object({ questionId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const entry = await ctx.db.errorBookEntry.findFirst({
        where: {
          userId: ctx.auth.userId,
          questionId: input.questionId,
          status: { in: ["ACTIVE", "ARCHIVED"] },
        },
        // partial unique idx 保证 (user, question, ACTIVE|ARCHIVED) 至多 1 行；
        // orderBy 仅为防御（万一 idx 不在测试 DB），不影响生产正确性。
        orderBy: { createdAt: "desc" },
      });
      if (!entry) return { entry: null };
      return {
        entry: {
          id: entry.id,
          status: entry.status,
          rootCause: entry.rootCause,
          rootCauseReasoning: entry.rootCauseReasoning,
        },
      };
    }),

  // === list ===
  // spec §3.1 + §5.1.2: default 错题本 = ACTIVE only. ARCHIVED is "moved out
  // of the default view" — the archived page must explicitly pass
  // status: "ARCHIVED". The zod enum deliberately omits "DELETED" so any
  // client (legit or hostile) probing for deleted entries gets BAD_REQUEST,
  // never a leaked row.
  list: consentGatedProcedure
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
  getById: consentGatedProcedure
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
  dueForReview: consentGatedProcedure
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
  markReviewed: consentGatedProcedure
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
  archive: consentGatedProcedure
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
  delete: consentGatedProcedure
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
