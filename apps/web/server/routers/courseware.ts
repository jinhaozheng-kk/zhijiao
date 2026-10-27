import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  authedProcedure,
  requireTeacherPersona,
  requireGuardianConsent,
  chargeMiddleware,
  validateCoursewareOwnership,
  router,
} from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { persistGeneratedCourseware } from "../lib/courseware-generation.js";
import {
  getCoursewareReviewWarningsFromParams,
  repairInstructionsForCourseware,
  reviewGeneratedCourseware,
  type CoursewareReviewIssue,
} from "../lib/courseware-review.js";

// 课件生成单价（3 credits）低于出卷，但单次耗时更长；给 1 轮带反馈的修复机会，
// 修复后仍有 BLOCKER 则整次失败并走既有扣费补偿（平台承担修复调用成本）。
const MAX_COURSEWARE_REVIEW_REPAIR_ATTEMPTS = 1;

const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]),
  teachingGoal: z.string().max(500).optional(),
  clientRequestId: z.string().uuid(),
});

export const coursewareRouter = router({
  generate: authedProcedure
    .input(GenInput) // schema validation before any middleware — malformed input fails before charge
    .use(requireTeacherPersona) // non-teacher fails before DEBIT is written
    .use(requireGuardianConsent)
    .use(chargeMiddleware("LESSON_PLAN_GEN")) // fixed 3 credits
    .mutation(async ({ ctx, input }) => {
      // KP → subject validation runs AFTER charge by design: a BAD_REQUEST here
      // triggers shouldCompensate → true, refunding the debit. Net balance = 0.
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
        select: { id: true, name: true },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "知识点与学科不匹配",
          cause: { reason: "KP_SUBJECT_MISMATCH" },
        });
      }
      const kpNames = kps.map((k) => k.name);

      let ai;
      let reviewIssues: CoursewareReviewIssue[] = [];
      let blockers: CoursewareReviewIssue[] = [];
      let repairRounds = 0;
      const modelCallIds: string[] = [];
      try {
        // v2 prompt：按「可直接进课堂」的完整度写五段（v1 实测每段仅 100–230 字）。
        const aiRouter = getAiRouter(ctx.auth.userId, { promptVersion: "v2" });
        for (let attempt = 0; ; attempt++) {
          ai = await aiRouter.generateLessonPlan({
            gradeLevel: input.gradeLevel,
            kpNames,
            teachingGoal: input.teachingGoal,
            // 修复轮：把上一轮的 blocker 翻成可执行修订要求再生成一次。
            ...(attempt > 0 ? { qualityInstructions: repairInstructionsForCourseware(blockers) } : {}),
          });
          modelCallIds.push(ai.modelCallId);
          reviewIssues = reviewGeneratedCourseware({ title: ai.title, sections: ai.sections });
          blockers = reviewIssues.filter((issue) => issue.severity === "BLOCKER");
          if (blockers.length === 0) {
            repairRounds = attempt;
            break;
          }
          if (attempt >= MAX_COURSEWARE_REVIEW_REPAIR_ATTEMPTS) {
            repairRounds = attempt;
            break;
          }
        }
        if (blockers.length > 0 || !ai) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "自动质检未通过，未生成可用课件。请调整知识点或稍后再试。",
            cause: {
              reason: "COURSEWARE_REVIEW_BLOCKED",
              blockers: blockers.map((b) => b.code),
            },
          });
        }
      } catch (e) {
        // 质检失败已是面向客户端的错误：不要再包成「课件生成失败」。
        if (e instanceof TRPCError) throw e;
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "生成内容未通过合规检查，请调整参数重试。",
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "课件生成失败，请稍后再试。",
          cause: { reason: "COURSEWARE_INTERNAL" },
        });
      }

      const cw = await persistGeneratedCourseware(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title: ai.title,
        gradeLevel: input.gradeLevel,
        paramsJson: {
          subjectId: input.subjectId,
          kpIds: input.kpIds,
          kpNames,
          gradeLevel: input.gradeLevel,
          teachingGoal: input.teachingGoal ?? null,
          promptVersion: "v2",
          repairRounds,
          modelCallIds,
          // BLOCKER 已在上方触发失败/补偿，落库的课件只带 warnings 供教师核对。
          reviewWarnings: reviewIssues.filter((issue) => issue.severity === "WARNING"),
          reviewBlockers: [],
        } as unknown as Prisma.InputJsonValue,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId: modelCallIds[0] ?? ai.modelCallId,
        sections: ai.sections,
      });
      return { coursewareId: cw.id };
    }),

  list: authedProcedure.use(requireTeacherPersona).query(async ({ ctx }) => {
    return ctx.db.courseware.findMany({
      where: { teacherUserId: ctx.auth.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, gradeLevel: true, createdAt: true },
    });
  }),

  get: authedProcedure
    .use(requireTeacherPersona)
    .use(validateCoursewareOwnership)
    .input(z.object({ coursewareId: z.string().cuid() }))
    .query(async ({ ctx }) => ({
      courseware: ctx.courseware,
      // 质量门 warnings 由服务端从 paramsJson 解析后返回，客户端不直接依赖服务端库。
      reviewWarnings: getCoursewareReviewWarningsFromParams(ctx.courseware.paramsJson),
    })),

  markReady: authedProcedure
    .use(requireTeacherPersona)
    .use(validateCoursewareOwnership)
    .input(z.object({ coursewareId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.courseware.update({
        where: { id: ctx.courseware.id },
        data: { status: "READY" },
      });
      return { ok: true };
    }),

  updateSection: authedProcedure
    .use(requireTeacherPersona)
    .use(validateCoursewareOwnership)
    .input(
      z.object({
        coursewareId: z.string().cuid(),
        sectionId: z.string().cuid(),
        title: z.string().min(1).max(200).optional(),
        contentMd: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sec = ctx.courseware.sections.find((s) => s.id === input.sectionId);
      if (!sec) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "段落不存在",
          cause: { reason: "SECTION_NOT_FOUND" },
        });
      }
      await ctx.db.coursewareSection.update({
        where: { id: input.sectionId },
        data: { title: input.title ?? undefined, contentMd: input.contentMd ?? undefined },
      });
      return { ok: true };
    }),
});
