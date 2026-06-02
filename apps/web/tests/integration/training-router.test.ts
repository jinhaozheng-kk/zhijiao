import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";
import { appRouter } from "@/server/routers/_root";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-training",
    resHeaders: new Headers(),
    cookies: {},
  };
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function seedFocusEntry(userId: string) {
  const subjectId = randomUUID();
  const kpId = randomUUID();
  const questionId = randomUUID();
  await prisma.subject.create({ data: { id: subjectId, code: `s-${kpId}`, name: "数学" } });
  await prisma.knowledgePoint.create({
    data: { id: kpId, subjectId, code: `k-${kpId}`, name: "一次函数与一元一次方程关系" },
  });
  await prisma.question.create({
    data: {
      id: questionId,
      subjectId,
      stemMd: "解方程 2x+1=0 并说明与图像交点的关系",
      type: "CALCULATION",
      status: "PUBLISHED",
      source: "USER_ADHOC",
      createdByUserId: userId,
    },
  });
  await prisma.questionKPLink.create({ data: { questionId, kpId, weight: 1 } });
  // Make the KP FOCUS via a teacher-graded WRONG sample.
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
  // Put the question in the student's ACTIVE error book.
  await prisma.errorBookEntry.create({
    data: {
      id: randomUUID(),
      userId,
      questionId,
      status: "ACTIVE",
      rootCause: "CALCULATION_SLIP",
      rootCauseReasoning: "漏了 y=0",
      nextReviewAt: new Date(),
    },
  });
  return { kpId, questionId };
}

describe("training router", () => {
  it("startSession returns FOCUS-KP items from the student's error book", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const { questionId } = await seedFocusEntry(userId);

    const caller = appRouter.createCaller(makeCtx(userId));
    const session = await caller.training.startSession({ window: "ALL" });

    expect(session.status).toBe("OK");
    expect(session.items.map((i) => i.questionId)).toContain(questionId);
    expect(session.sessionId).toBeTruthy();
  });

  it("submitAttempt records a TrainingAttempt and advances the review ladder on KNOW", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const { kpId, questionId } = await seedFocusEntry(userId);

    const caller = appRouter.createCaller(makeCtx(userId));
    const session = await caller.training.startSession({ window: "ALL" });
    await caller.training.submitAttempt({
      sessionId: session.sessionId,
      questionId,
      source: "ERROR_BOOK",
      kpIds: [kpId],
      selfResult: "KNOW",
    });

    const attempts = await prisma.trainingAttempt.findMany({ where: { studentUserId: userId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.gradeStatus).toBe("CORRECT");
    const entry = await prisma.errorBookEntry.findFirstOrThrow({ where: { userId, questionId } });
    expect(entry.reviewCount).toBe(1);
    expect(entry.lastReviewedAt).not.toBeNull();
  });

  it("submitAttempt rejects a questionId the caller does not own", async () => {
    const userId = randomUUID();
    const strangerQ = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.training.submitAttempt({
        sessionId: randomUUID(),
        questionId: strangerQ,
        source: "ERROR_BOOK",
        kpIds: [],
        selfResult: "UNSURE",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
