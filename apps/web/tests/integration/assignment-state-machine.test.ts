import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { makeCtx, redis } from "./_helpers/error-book-fixtures";
import {
  seedDraftAssignment,
  seedPublishedAssignment,
  seedPublishedStudentAssignment,
} from "./_helpers/assignment-fixtures";

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

describe("assignment state machine", () => {
  it("publishes a draft and creates student assignments", async () => {
    const { teacher, students, assignment } = await seedDraftAssignment();
    const caller = appRouter.createCaller(makeCtx(teacher.id));

    await caller.assignment.publish({ assignmentId: assignment.id });

    const reread = await prisma.assignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(reread.status).toBe("PUBLISHED");

    const studentAssignmentCount = await prisma.studentAssignment.count({
      where: { assignmentId: assignment.id },
    });
    expect(studentAssignmentCount).toBe(students.length);
  });

  it("rejects editing after publish", async () => {
    const { teacher, assignment } = await seedPublishedAssignment();
    const caller = appRouter.createCaller(makeCtx(teacher.id));

    await expect(
      caller.assignment.updateDraft({
        assignmentId: assignment.id,
        title: "New title",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("student can submit only assigned tier items once", async () => {
    const { student, studentAssignment, assignedItem, otherTierItem } =
      await seedPublishedStudentAssignment();
    const caller = appRouter.createCaller(makeCtx(student.id));

    await expect(
      caller.assignment.submit({
        studentAssignmentId: studentAssignment.id,
        answers: [{ itemId: otherTierItem.id, answerJson: { text: "x" } }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.assignment.submit({
      studentAssignmentId: studentAssignment.id,
      answers: [{ itemId: assignedItem.id, answerJson: { text: "x = 4" } }],
    });

    await expect(
      caller.assignment.submit({
        studentAssignmentId: studentAssignment.id,
        answers: [{ itemId: assignedItem.id, answerJson: { text: "x = 4" } }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
