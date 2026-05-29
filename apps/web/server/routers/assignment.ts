import "server-only";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  authedProcedure,
  chargeVariableMiddleware,
  router,
} from "../trpc.js";
import { getAiRouter } from "@/lib/ai-client";
import {
  requireTeacherAnswer,
  requireTeacherAssignment,
  requireTeacherClassroom,
} from "../lib/assignment-access.js";
import { persistGeneratedAssignment } from "../lib/assignment-generation.js";
import { gradeAssignmentAnswer } from "../lib/assignment-writeback.js";

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

const ErrorRootCauseSchema = z.enum([
  "CONCEPT_CONFUSION",
  "READING_ERROR",
  "FORMULA_MISUSE",
  "CALCULATION_SLIP",
  "TRANSFER_GAP",
  "OTHER",
]);

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

  updateDraft: authedProcedure
    .input(
      z.object({
        assignmentId: z.string().cuid(),
        title: z.string().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const assignment = await requireTeacherAssignment(
        ctx.db,
        ctx.auth.userId,
        input.assignmentId,
      );
      if (assignment.status !== "DRAFT") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Assignment state changed",
          cause: { reason: "ASSIGNMENT_STATE_CHANGED" },
        });
      }
      return ctx.db.assignment.update({
        where: { id: input.assignmentId },
        data: { title: input.title },
      });
    }),

  publish: authedProcedure
    .input(z.object({ assignmentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await requireTeacherAssignment(
        ctx.db,
        ctx.auth.userId,
        input.assignmentId,
      );
      if (assignment.status !== "DRAFT") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Assignment state changed",
          cause: { reason: "ASSIGNMENT_STATE_CHANGED" },
        });
      }

      const studentMembers = await ctx.db.classroomMember.findMany({
        where: { classroomId: assignment.classroomId, role: "STUDENT" },
      });
      if (studentMembers.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Classroom has no students",
          cause: { reason: "CLASSROOM_HAS_NO_STUDENTS" },
        });
      }

      const tiers = assignment.tiers;
      if (tiers.length === 0 || tiers.some((tier) => tier.items.length === 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Assignment tier is empty",
          cause: { reason: "ASSIGNMENT_TIER_EMPTY" },
        });
      }

      return ctx.db.$transaction(async (tx) => {
        await tx.assignment.update({
          where: { id: assignment.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
        const defaultTier =
          tiers.find((tier) => tier.level === "CONSOLIDATION") ?? tiers[0]!;
        for (const member of studentMembers) {
          await tx.studentAssignment.upsert({
            where: {
              assignmentId_studentUserId: {
                assignmentId: assignment.id,
                studentUserId: member.userId,
              },
            },
            update: {
              tierId: defaultTier.id,
              suggestedTier: defaultTier.level,
            },
            create: {
              assignmentId: assignment.id,
              studentUserId: member.userId,
              tierId: defaultTier.id,
              suggestedTier: defaultTier.level,
            },
          });
        }
        return { assignmentId: assignment.id };
      });
    }),

  getForStudent: authedProcedure
    .input(z.object({ studentAssignmentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const studentAssignment = await ctx.db.studentAssignment.findUnique({
        where: { id: input.studentAssignmentId },
        include: {
          assignment: true,
          tier: { include: { items: { orderBy: { position: "asc" } } } },
          answers: true,
        },
      });
      if (
        !studentAssignment ||
        studentAssignment.studentUserId !== ctx.auth.userId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Student assignment not found",
          cause: { reason: "STUDENT_ASSIGNMENT_NOT_FOUND" },
        });
      }
      return { studentAssignment };
    }),

  listForStudent: authedProcedure.query(async ({ ctx }) => {
    const assignments = await ctx.db.studentAssignment.findMany({
      where: { studentUserId: ctx.auth.userId },
      orderBy: { createdAt: "desc" },
      include: {
        assignment: { include: { classroom: true } },
        tier: true,
      },
    });
    return { assignments };
  }),

  submit: authedProcedure
    .input(
      z.object({
        studentAssignmentId: z.string().cuid(),
        answers: z
          .array(
            z.object({
              itemId: z.string().cuid(),
              answerJson: z.unknown(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const studentAssignment = await ctx.db.studentAssignment.findUnique({
        where: { id: input.studentAssignmentId },
        include: {
          assignment: true,
          tier: { include: { items: true } },
        },
      });
      if (
        !studentAssignment ||
        studentAssignment.studentUserId !== ctx.auth.userId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Student assignment not found",
          cause: { reason: "STUDENT_ASSIGNMENT_NOT_FOUND" },
        });
      }
      if (
        studentAssignment.assignment.status !== "PUBLISHED" ||
        studentAssignment.status !== "ASSIGNED"
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Assignment state changed",
          cause: { reason: "ASSIGNMENT_STATE_CHANGED" },
        });
      }

      const allowedItemIds = new Set(
        studentAssignment.tier.items.map((item) => item.id),
      );
      const submittedItemIds = new Set<string>();
      for (const answer of input.answers) {
        if (
          !allowedItemIds.has(answer.itemId) ||
          submittedItemIds.has(answer.itemId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Answer item is not assigned",
            cause: { reason: "ASSIGNMENT_ITEM_NOT_ASSIGNED" },
          });
        }
        submittedItemIds.add(answer.itemId);
      }

      return ctx.db.$transaction(async (tx) => {
        for (const answer of input.answers) {
          await tx.assignmentAnswer.create({
            data: {
              studentAssignmentId: studentAssignment.id,
              itemId: answer.itemId,
              answerJson: answer.answerJson as Prisma.InputJsonValue,
            },
          });
        }
        return tx.studentAssignment.update({
          where: { id: studentAssignment.id },
          data: { status: "SUBMITTED", submittedAt: new Date() },
        });
      });
    }),

  gradeAnswer: authedProcedure
    .input(
      z.object({
        answerId: z.string().cuid(),
        gradeStatus: z.enum(["CORRECT", "PARTIAL", "WRONG"]),
        rootCause: ErrorRootCauseSchema.optional(),
        teacherFeedbackMd: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTeacherAnswer(ctx.db, ctx.auth.userId, input.answerId);
      return gradeAssignmentAnswer(ctx.db, input);
    }),
});
