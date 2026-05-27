import type { Prisma, PrismaClient } from "@prisma/client";
import type { AssignmentQuestionGenerationOutput } from "@zhijiao/ai";
import { reconcileHintsSync } from "./kp-reconcile.js";

export async function persistGeneratedAssignment(
  db: PrismaClient,
  args: {
    teacherUserId: string;
    classroomId: string;
    subjectId: string;
    output: AssignmentQuestionGenerationOutput;
    debitLedgerId: string;
    modelCallId: string;
    source: "WEAKNESS_AI" | "MANUAL_AI";
  },
) {
  const createdQuestions: Array<{ questionId: string; hints: string[] }> = [];

  const assignment = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.create({
      data: {
        classroomId: args.classroomId,
        teacherUserId: args.teacherUserId,
        title: args.output.title,
        source: args.source,
        generationLedgerId: args.debitLedgerId,
        generationCallId: args.modelCallId,
      },
    });

    for (const tierOutput of args.output.tiers) {
      const tier = await tx.assignmentTier.create({
        data: {
          assignmentId: assignment.id,
          level: tierOutput.level,
          title: tierOutput.level,
          rationaleMd: tierOutput.rationaleMd,
        },
      });

      for (const [idx, item] of tierOutput.items.entries()) {
        const question = await tx.question.create({
          data: {
            subjectId: args.subjectId,
            stemMd: item.stemMd,
            type: item.type,
            difficulty: item.difficulty,
            status: "DRAFT",
            source: "ASSIGNMENT_GENERATED",
            createdByUserId: args.teacherUserId,
            answer: {
              create: {
                contentMd: item.answerMd,
                solutionMd: item.solutionMd,
              },
            },
          },
        });

        await tx.assignmentItem.create({
          data: {
            tierId: tier.id,
            questionId: question.id,
            position: idx + 1,
            stemMd: item.stemMd,
            type: item.type,
            optionsJson: item.options as Prisma.InputJsonValue | undefined,
            answerMd: item.answerMd,
            solutionMd: item.solutionMd,
            rubricMd: item.rubricMd,
            kpHints: item.knowledgePointHints,
          },
        });
        createdQuestions.push({
          questionId: question.id,
          hints: item.knowledgePointHints,
        });
      }
    }

    return assignment;
  });

  for (const created of createdQuestions) {
    await reconcileHintsSync(db, {
      questionId: created.questionId,
      hints: created.hints,
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: created.questionId,
    });
  }

  return assignment;
}
