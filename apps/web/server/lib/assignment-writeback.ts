import "server-only";
import { TRPCError } from "@trpc/server";
import type {
  AssignmentGradeStatus,
  ErrorRootCause,
  PrismaClient,
} from "@prisma/client";

export async function gradeAssignmentAnswer(
  db: PrismaClient,
  args: {
    answerId: string;
    gradeStatus: Exclude<AssignmentGradeStatus, "UNGRADED">;
    rootCause?: ErrorRootCause;
    teacherFeedbackMd?: string;
  },
) {
  if (
    (args.gradeStatus === "PARTIAL" || args.gradeStatus === "WRONG") &&
    !args.rootCause
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Root cause is required for incorrect assignment answers",
      cause: { reason: "ROOT_CAUSE_REQUIRED" },
    });
  }

  return db.$transaction(async (tx) => {
    const answer = await tx.assignmentAnswer.findUniqueOrThrow({
      where: { id: args.answerId },
      include: {
        item: { include: { question: { include: { knowledgePoints: true } } } },
        studentAssignment: true,
      },
    });

    let errorBookEntryId: string | null = null;
    if (args.gradeStatus === "PARTIAL" || args.gradeStatus === "WRONG") {
      const questionId = answer.item.questionId;
      if (!questionId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Assignment item is missing a question reference",
          cause: { reason: "ASSIGNMENT_ITEM_QUESTION_MISSING" },
        });
      }

      const data = {
        rootCause: args.rootCause!,
        rootCauseReasoning:
          args.teacherFeedbackMd ?? "Assignment grading writeback",
        actualAnswerMd: JSON.stringify(answer.answerJson),
        status: "ACTIVE" as const,
        nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      const existing = await tx.errorBookEntry.findFirst({
        where: {
          userId: answer.studentAssignment.studentUserId,
          questionId,
          status: { in: ["ACTIVE", "ARCHIVED"] },
        },
      });
      const entry = existing
        ? await tx.errorBookEntry.update({
            where: { id: existing.id },
            data,
          })
        : await tx.errorBookEntry.create({
            data: {
              userId: answer.studentAssignment.studentUserId,
              questionId,
              ...data,
            },
          });
      errorBookEntryId = entry.id;
    }

    const graded = await tx.assignmentAnswer.update({
      where: { id: args.answerId },
      data: {
        gradeStatus: args.gradeStatus,
        teacherFeedbackMd: args.teacherFeedbackMd,
        errorBookEntryId,
        gradedAt: new Date(),
      },
    });

    const kpIds =
      answer.item.question?.knowledgePoints.map((link) => link.kpId) ?? [];
    await tx.assignmentPerformance.upsert({
      where: {
        assignmentId_studentUserId_itemId: {
          assignmentId: answer.studentAssignment.assignmentId,
          studentUserId: answer.studentAssignment.studentUserId,
          itemId: answer.itemId,
        },
      },
      update: {
        gradeStatus: args.gradeStatus,
        kpIds,
      },
      create: {
        assignmentId: answer.studentAssignment.assignmentId,
        studentUserId: answer.studentAssignment.studentUserId,
        itemId: answer.itemId,
        gradeStatus: args.gradeStatus,
        kpIds,
      },
    });

    const remainingUngraded = await tx.assignmentAnswer.count({
      where: {
        studentAssignmentId: answer.studentAssignmentId,
        gradeStatus: "UNGRADED",
      },
    });
    if (remainingUngraded === 0) {
      await tx.studentAssignment.update({
        where: { id: answer.studentAssignmentId },
        data: { status: "GRADED", gradedAt: new Date() },
      });
    }

    return graded;
  });
}
