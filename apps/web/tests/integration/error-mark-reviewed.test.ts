import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
} from "./_helpers/error-book-fixtures";

const { appRouter } = await import("@/server/routers/_root");

const DAY = 24 * 60 * 60 * 1000;

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

// Helper: assert nextReviewAt is approximately `lastReviewedAt + expectedDelta`
// (within a 5s slack, since we don't fake the clock).
function expectIntervalRoughly(
  lastReviewedAt: Date | null,
  nextReviewAt: Date | null,
  expectedDeltaMs: number,
) {
  expect(lastReviewedAt).not.toBeNull();
  expect(nextReviewAt).not.toBeNull();
  const delta = new Date(nextReviewAt!).getTime() - new Date(lastReviewedAt!).getTime();
  expect(delta).toBeGreaterThanOrEqual(expectedDeltaMs - 5_000);
  expect(delta).toBeLessThanOrEqual(expectedDeltaMs + 5_000);
}

describe("error.markReviewed — interval ladder", () => {
  it("first mark: reviewCount 0→1, nextReviewAt = lastReviewedAt + 1d", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      reviewCount: 0,
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entry: after } = await caller.error.markReviewed({ entryId: entry.id });
    expect(after.reviewCount).toBe(1);
    expectIntervalRoughly(after.lastReviewedAt, after.nextReviewAt, 1 * DAY);
  });

  it("interval progression: 2nd→+3d, 3rd→+7d, 4th→+14d, 5th→+30d", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);

    const expected: Array<[number, number]> = [
      [1, 1 * DAY],
      [2, 3 * DAY],
      [3, 7 * DAY],
      [4, 14 * DAY],
      [5, 30 * DAY],
    ];

    // Each test scenario gets a fresh question + entry so we don't have to
    // chain markReviewed calls (which would interleave timing).
    const subj = await prisma.subject.findFirstOrThrow();
    for (const [startCount, expectedDelta] of expected) {
      const q = await prisma.question.create({
        data: {
          subjectId: subj.id,
          stemMd: `step-${startCount}`,
          type: "CALCULATION",
          status: "PUBLISHED",
        },
      });
      const e = await seedErrorBookEntry({
        userId: u.id,
        questionId: q.id,
        status: "ACTIVE",
        reviewCount: startCount - 1,
      });
      const caller = appRouter.createCaller(makeCtx(u.id));
      const { entry: after } = await caller.error.markReviewed({ entryId: e.id });
      expect(after.reviewCount).toBe(startCount);
      expectIntervalRoughly(after.lastReviewedAt, after.nextReviewAt, expectedDelta);
    }
  });

  it("cap at 30d: 10th mark still produces +30d (not unbounded growth)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      reviewCount: 9, // next mark sets it to 10
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entry: after } = await caller.error.markReviewed({ entryId: entry.id });
    expect(after.reviewCount).toBe(10);
    expectIntervalRoughly(after.lastReviewedAt, after.nextReviewAt, 30 * DAY);
  });

  it("ARCHIVED entry: PRECONDITION_FAILED/ENTRY_NOT_ACTIVE (no DB write)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      reviewCount: 2,
      nextReviewAt: null,
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.markReviewed({ entryId: entry.id }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { reason: "ENTRY_NOT_ACTIVE" },
    });

    // DB-truth: reviewCount unchanged, no schedule update.
    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.reviewCount).toBe(2);
    expect(reloaded.lastReviewedAt).toBeNull();
    expect(reloaded.nextReviewAt).toBeNull();
  });

  it("DELETED entry: NOT_FOUND/ENTRY_NOT_FOUND (validateEntryOwnership blocks)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.markReviewed({ entryId: entry.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "ENTRY_NOT_FOUND" },
    });
  });

  it("cross-user entry: NOT_FOUND/ENTRY_NOT_FOUND (anti existence leak)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const a = await seedUserWithBalance(0);
    const b = await seedUserWithBalance(0);
    const aEntry = await seedErrorBookEntry({
      userId: a.id,
      questionId,
      status: "ACTIVE",
    });
    const callerB = appRouter.createCaller(makeCtx(b.id));
    await expect(
      callerB.error.markReviewed({ entryId: aEntry.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "ENTRY_NOT_FOUND" },
    });
  });
});
