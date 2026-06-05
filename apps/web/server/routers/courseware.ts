import "server-only";
import { z } from "zod";
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
      try {
        ai = await getAiRouter(ctx.auth.userId).generateLessonPlan({
          gradeLevel: input.gradeLevel,
          kpNames,
          teachingGoal: input.teachingGoal,
        });
      } catch (e) {
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
          gradeLevel: input.gradeLevel,
          teachingGoal: input.teachingGoal ?? null,
        },
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId: ai.modelCallId,
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
    .query(async ({ ctx }) => ({ courseware: ctx.courseware })),

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
