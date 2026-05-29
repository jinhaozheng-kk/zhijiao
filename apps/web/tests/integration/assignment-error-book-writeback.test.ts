import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { makeCtx, redis } from "./_helpers/error-book-fixtures";
import { seedSubmittedAssignmentAnswer } from "./_helpers/assignment-fixtures";

beforeAll(async () => {
  await redis.flushdb();
});

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe("assignment grading error-book writeback", () => {
  it("correct grade writes performance but not error book", async () => {
    const { teacher, answer, kp, studentAssignment } =
      await seedSubmittedAssignmentAnswer();
    const caller = appRouter.createCaller(makeCtx(teacher.id));

    await caller.assignment.gradeAnswer({
      answerId: answer.id,
      gradeStatus: "CORRECT",
      teacherFeedbackMd: "Complete solution.",
    });

    expect(await prisma.assignmentPerformance.count()).toBe(1);
    const performance = await prisma.assignmentPerformance.findFirstOrThrow();
    expect(performance.gradeStatus).toBe("CORRECT");
    expect(performance.kpIds).toEqual([kp.id]);
    expect(await prisma.errorBookEntry.count()).toBe(0);

    const rereadStudentAssignment =
      await prisma.studentAssignment.findUniqueOrThrow({
        where: { id: studentAssignment.id },
      });
    expect(rereadStudentAssignment.status).toBe("GRADED");
    expect(rereadStudentAssignment.gradedAt).toBeTruthy();
  });

  it("wrong grade requires root cause and writes error book", async () => {
    const { teacher, answer, student, question } =
      await seedSubmittedAssignmentAnswer();
    const caller = appRouter.createCaller(makeCtx(teacher.id));

    await expect(
      caller.assignment.gradeAnswer({
        answerId: answer.id,
        gradeStatus: "WRONG",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.assignment.gradeAnswer({
      answerId: answer.id,
      gradeStatus: "WRONG",
      rootCause: "FORMULA_MISUSE",
      teacherFeedbackMd: "Sign handling was incorrect.",
    });

    const reread = await prisma.assignmentAnswer.findUniqueOrThrow({
      where: { id: answer.id },
    });
    expect(reread.gradeStatus).toBe("WRONG");
    expect(reread.errorBookEntryId).toBeTruthy();

    const entry = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: reread.errorBookEntryId! },
    });
    expect(entry.userId).toBe(student.id);
    expect(entry.questionId).toBe(question.id);
    expect(entry.rootCause).toBe("FORMULA_MISUSE");
    expect(entry.status).toBe("ACTIVE");
  });
});
