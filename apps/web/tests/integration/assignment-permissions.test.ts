import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { makeCtx, redis } from "./_helpers/error-book-fixtures";
import {
  seedDraftAssignment,
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

describe("assignment permissions", () => {
  it("teacher cannot publish another teacher assignment", async () => {
    const { otherTeacher, assignment } = await seedDraftAssignment();
    const caller = appRouter.createCaller(makeCtx(otherTeacher.id));

    await expect(
      caller.assignment.publish({ assignmentId: assignment.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("student cannot read another student's assignment", async () => {
    const { otherStudent, studentAssignment } =
      await seedPublishedStudentAssignment();
    const caller = appRouter.createCaller(makeCtx(otherStudent.id));

    await expect(
      caller.assignment.getForStudent({
        studentAssignmentId: studentAssignment.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
