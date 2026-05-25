import "server-only";
import { z } from "zod";
import {
  authedProcedure,
  chargeMiddleware,
  validateTutorInputCompliance,
  router,
} from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { upsertUserAdhocQuestion } from "../lib/question.js";
import { reconcileHintsSync } from "../lib/kp-reconcile.js";
import { logger } from "../logger.js";

// Plan 8: tutor.ask 改用 explicit middleware chain（不用 chargedProcedure 糖语法），
// 因为要插 validateTutorInputCompliance 在 chargeMiddleware 之前。
// chargedProcedure factory 保留不动（error/variant 路由仍可用）；Plan 3/4 调用点零行 diff。
const TutorAskInputSchema = TutoringInputSchema.extend({
  clientRequestId: z.string().uuid(),
});

export const tutorRouter = router({
  ask: authedProcedure
    .use(validateTutorInputCompliance)                       // Plan 8: 扣费前扫违禁词
    .use(chargeMiddleware("TUTOR_ASK"))                      // 沿用 Plan 4 抽出的 factory
    .input(TutorAskInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { clientRequestId: _clientRequestId, ...aiInput } = input;
      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).tutor(aiInput);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
            // `original` preserves the upstream Error so chargedProcedure
            // can pull its class name for audit; `reason` is the
            // client-facing semantic that errorFormatter surfaces and that
            // shouldCompensate(...) recognizes as the no-refund whitelist.
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "讲解失败，请稍后再试。",
          cause: { reason: "TUTOR_INTERNAL" },
        });
      }
      // Plan 8 spec §3.3 / §3.4: AI 成功才落 Question — 否则 AI 失败被 chargeMiddleware
      // 补偿，但 Question 已建会成孤儿。Order is load-bearing: do not move this above
      // the AI call.
      //
      // 注：helper 直接接 ctx.db (PrismaClient) — 不包 $transaction。原因见 question.ts
      // 的 doc：tx 内 P2002 catch 后无法在同 tx 重读（Postgres 25P02 tx aborted）。
      const question = await upsertUserAdhocQuestion(ctx.db, {
        userId: ctx.auth.userId,
        stemMd: input.questionStem,
      });

      // Plan 9: AI 给的 knowledgePoints 走 reconcile（exact/alias sync 命中即 LINKED
      // QuestionKPLink；miss 进 UNMATCHED 等异步 LLM）。await + try/catch + 必须**不**
      // 破坏主流程（红线 #1）—— 用户已付费拿到讲解，KP reconcile 是后台增强。
      try {
        await reconcileHintsSync(ctx.db, {
          questionId: question.id,
          hints: ai.knowledgePoints,
          source: "TUTOR_ADHOC",
          sourceRefType: "QUESTION",
          sourceRefId: question.id,
        });
      } catch (e) {
        logger.warn({
          event: "kp_reconcile_sync_failed",
          source: "TUTOR_ADHOC",
          questionId: question.id,
          err: String(e),
        });
      }

      return { ...ai, questionId: question.id };
    }),
});
