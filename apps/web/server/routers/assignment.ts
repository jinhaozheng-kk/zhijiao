import "server-only";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  authedProcedure,
  chargeVariableMiddleware,
  router,
} from "../trpc.js";
import { getAiRouter } from "@/lib/ai-client";
import { requireTeacherClassroom } from "../lib/assignment-access.js";
import { persistGeneratedAssignment } from "../lib/assignment-generation.js";

const TierCountsSchema = z.object({
  BASIC: z.number().int().min(0).max(10),
  CONSOLIDATION: z.number().int().min(0).max(10),
  CHALLENGE: z.number().int().min(0).max(10),
});

function totalCount(input: unknown): number {
  const parsed = z.object({ tierCounts: TierCountsSchema }).parse(input);
  return (
    parsed.tierCounts.BASIC +
    parsed.tierCounts.CONSOLIDATION +
    parsed.tierCounts.CHALLENGE
  );
}

const QuestionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
]);

const GenerateCriteriaInput = z.object({
  classroomId: z.string().cuid(),
  clientRequestId: z.string().uuid(),
  subjectId: z.string().cuid(),
  gradeLevel: z.string().min(1),
  kpIds: z.array(z.string().cuid()).min(1).max(8),
  difficultyRange: z.tuple([
    z.number().int().min(1).max(5),
    z.number().int().min(1).max(5),
  ]),
  tierCounts: TierCountsSchema,
  questionTypes: z.array(QuestionTypeSchema).min(1),
  teachingGoalMd: z.string().max(2000).optional(),
});

export const assignmentRouter = router({
  generateDraftFromCriteria: authedProcedure
    .input(GenerateCriteriaInput)
    .use(async ({ ctx, next, input }) => {
      const classroom = await requireTeacherClassroom(
        ctx.db,
        ctx.auth.userId,
        input.classroomId,
      );
      if (classroom.subjectId !== input.subjectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subject does not match classroom",
          cause: { reason: "CLASSROOM_SUBJECT_MISMATCH" },
        });
      }
      const count = totalCount(input);
      if (count <= 0 || count > 30) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid generation count",
          cause: { reason: "ASSIGNMENT_GENERATION_COUNT_INVALID" },
        });
      }
      return next();
    })
    .use(chargeVariableMiddleware("ASSIGNMENT_QUESTION_GEN", totalCount))
    .mutation(async ({ ctx, input }) => {
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Knowledge points do not belong to the subject",
          cause: { reason: "KP_SUBJECT_MISMATCH" },
        });
      }

      const ai = getAiRouter(ctx.auth.userId);
      const output = await ai.generateAssignmentQuestions({
        mode: "MANUAL_CRITERIA",
        subject: "Math",
        gradeLevel: input.gradeLevel,
        tierCounts: input.tierCounts,
        questionTypes: input.questionTypes,
        kpNames: kps.map((kp) => kp.name),
        difficultyRange: input.difficultyRange,
        teachingGoalMd: input.teachingGoalMd,
      });

      const assignment = await persistGeneratedAssignment(ctx.db, {
        teacherUserId: ctx.auth.userId,
        classroomId: input.classroomId,
        subjectId: input.subjectId,
        output,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId: output.modelCallId,
        source: "MANUAL_AI",
      });

      return { assignmentId: assignment.id };
    }),
});
