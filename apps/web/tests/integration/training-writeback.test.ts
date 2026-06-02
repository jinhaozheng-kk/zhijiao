import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { profileForStudent } from "@zhijiao/analytics";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeKp() {
  const subjectId = randomUUID();
  const kpId = randomUUID();
  await prisma.subject.create({
    data: { id: subjectId, code: `s-${kpId}`, name: "数学" },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: kpId,
      subjectId,
      code: `k-${kpId}`,
      name: "一次函数与一元一次方程关系",
    },
  });
  return kpId;
}

describe("profileForStudent blends TrainingAttempt", () => {
  it("a CORRECT training attempt raises the KP score (down-weighted)", async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, name: "学生", persona: "STUDENT" },
    });
    const kpId = await makeKp();

    // Baseline: one teacher-graded WRONG → score 0 on this KP.
    await prisma.assignmentPerformance.create({
      data: {
        id: randomUUID(),
        assignmentId: randomUUID(),
        studentUserId: userId,
        itemId: randomUUID(),
        gradeStatus: "WRONG",
        kpIds: [kpId],
      },
    });

    const before = await profileForStudent(prisma, { userId, window: "ALL" });
    const beforeScore = before.masteries.find((m) => m.kpId === kpId)?.score ?? 0;

    // A CORRECT training attempt on the same KP.
    await prisma.trainingAttempt.create({
      data: {
        sessionId: randomUUID(),
        studentUserId: userId,
        questionId: randomUUID(),
        source: "ERROR_BOOK",
        gradeStatus: "CORRECT",
        kpIds: [kpId],
      },
    });

    const after = await profileForStudent(prisma, { userId, window: "ALL" });
    const afterScore = after.masteries.find((m) => m.kpId === kpId)?.score ?? 0;

    expect(afterScore).toBeGreaterThan(beforeScore);
  });
});
