import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, chargeMiddleware, router } from "../trpc.js";
import { profileForStudent, classDiagnosis } from "@zhijiao/analytics";
import {
  getCachedJson,
  ANALYTICS_TTL_SEC,
  profileCacheKey,
  classCacheKey,
} from "../lib/learning-cache.js";
import { familyView } from "../lib/learning-projection.js";
import { requireProfileAccess } from "../lib/profile-access.js";
import { requireTeacherClassroom } from "../lib/assignment-access.js";
import { generateAdviceForProfile } from "../lib/learning-advice.js";
import { ComplianceRejectedError } from "@zhijiao/ai";

const WindowSchema = z.enum(["D30", "D90", "ALL"]).default("D90");

export const analyticsRouter = router({
  profile: router({
    // 学生本人完整画像
    mine: authedProcedure
      .input(z.object({ window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        const profile = await getCachedJson(
          profileCacheKey(ctx.auth.userId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: ctx.auth.userId, window: input.window }),
        );
        return { relationship: "self" as const, profile };
      }),

    // 家长/教师查指定学生：access helper 决定可见性 + 投影
    get: authedProcedure
      // min(1) not cuid(): seeded dev/E2E user ids are not cuids; requireProfileAccess is the real guard.
      .input(z.object({ studentUserId: z.string().min(1), window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        const rel = await requireProfileAccess(ctx.db, ctx.auth.userId, input.studentUserId);
        const profile = await getCachedJson(
          profileCacheKey(input.studentUserId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: input.studentUserId, window: input.window }),
        );
        if (rel === "parent") {
          return { relationship: rel, view: familyView(profile) };
        }
        return { relationship: rel, profile };
      }),

    // 学生本人付费 AI 学习建议（1 credit）。链：authed → charge（合规走 AI 输出扫描白名单不补偿）
    generateAdvice: authedProcedure
      .use(chargeMiddleware("LEARNING_ADVICE_GEN"))
      .input(z.object({ window: WindowSchema, clientRequestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const user = await ctx.db.user.findUnique({
          where: { id: ctx.auth.userId },
          select: { gradeLevel: true },
        });
        const profile = await getCachedJson(
          profileCacheKey(ctx.auth.userId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: ctx.auth.userId, window: input.window }),
        );
        if (!profile.hasData) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "数据不足，完成一些练习后再生成学习建议。",
            cause: { reason: "INSUFFICIENT_PROFILE_DATA" },
          });
        }
        try {
          const advice = await generateAdviceForProfile(
            ctx.auth.userId,
            profile,
            user?.gradeLevel ?? null,
          );
          return {
            summaryMd: advice.summaryMd,
            suggestions: advice.suggestions,
            encouragementMd: advice.encouragementMd,
          };
        } catch (e) {
          if (e instanceof ComplianceRejectedError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "学习建议未通过合规检查",
              cause: { reason: "COMPLIANCE_REJECTED", original: e },
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "生成学习建议失败",
            cause: { reason: "LEARNING_ADVICE_INTERNAL", original: e },
          });
        }
      }),
  }),

  classroom: router({
    diagnosis: authedProcedure
      // min(1) not cuid(): seeded dev/E2E classroom ids are not cuids; requireTeacherClassroom is the real guard.
      .input(z.object({ classroomId: z.string().min(1), window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        await requireTeacherClassroom(ctx.db, ctx.auth.userId, input.classroomId);
        const diagnosis = await getCachedJson(
          classCacheKey(input.classroomId, input.window),
          ANALYTICS_TTL_SEC,
          () => classDiagnosis(ctx.db, { classroomId: input.classroomId, window: input.window }),
        );
        return { diagnosis };
      }),
  }),
});
