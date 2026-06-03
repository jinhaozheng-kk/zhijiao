import "server-only";
import { z } from "zod";
import {
  authedProcedure,
  chargeMiddleware,
  validateTutorInputCompliance,
  router,
} from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { redactPii } from "@zhijiao/domain";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { getStorage } from "@/lib/storage";
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
      // Plan 14c：题面在喂 AI + 落库前脱敏（手机号/身份证）。脱敏后的 stem 同时
      // 喂 AI 与 upsert，确保模型与持久化都拿不到原始 PII。
      const { redacted: redactedStem, hits: piiHits } = redactPii(input.questionStem);
      if (piiHits.phone > 0 || piiHits.idCard > 0) {
        logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK", hits: piiHits });
      }
      aiInput.questionStem = redactedStem;
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
        stemMd: redactedStem,
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

  // 图片/OCR 拍照答疑：单次多模态调用（qwen-vl 转写 + 讲解），2 credits。
  // 合规/PII 后置（单次多模态调用前没有文本可前置扫）：AI 路由已在 parse 前脱敏
  // response + 扫违禁词（命中抛 ComplianceRejectedError）；本层再对 stemTranscript
  // 落库前脱敏。图片 owner-only（key 前缀门禁）。
  askImage: authedProcedure
    .use(chargeMiddleware("TUTOR_ASK_IMAGE"))
    .input(
      z.object({
        imageKey: z.string().min(1),
        studentGrade: z
          .enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"])
          .optional(),
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prefix = `adhoc/${ctx.auth.userId}/`;
      if (!input.imageKey.startsWith(prefix)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "图片不存在",
          cause: { reason: "IMAGE_NOT_FOUND" },
        });
      }
      const bytes = await getStorage().getBytes(input.imageKey);
      if (!bytes) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "图片不存在",
          cause: { reason: "IMAGE_NOT_FOUND" },
        });
      }
      const contentType = input.imageKey.endsWith(".png")
        ? "image/png"
        : input.imageKey.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      const imageDataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;

      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).tutorImage({
          imageDataUrl,
          studentGrade: input.studentGrade,
        });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一张图或稍后再试。",
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "识别失败，请稍后再试。",
          cause: { reason: "TUTOR_IMAGE_INTERNAL" },
        });
      }

      const { redacted: redactedStem, hits } = redactPii(ai.stemTranscript);
      if (hits.phone > 0 || hits.idCard > 0) {
        logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK_IMAGE", hits });
      }
      const question = await upsertUserAdhocQuestion(ctx.db, {
        userId: ctx.auth.userId,
        stemMd: redactedStem,
        stemImageKeys: [input.imageKey],
      });
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
          source: "TUTOR_IMAGE",
          questionId: question.id,
          err: String(e),
        });
      }
      const { stemTranscript: _t, modelCallId: _m, ...tutoring } = ai;
      return { ...tutoring, stemTranscript: redactedStem, questionId: question.id };
    }),
});
