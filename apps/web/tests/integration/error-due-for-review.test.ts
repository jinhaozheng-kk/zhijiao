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

async function makeQuestion(stemMd: string) {
  const subj = await prisma.subject.findFirstOrThrow();
  return prisma.question.create({
    data: { subjectId: subj.id, stemMd, type: "CALCULATION", status: "PUBLISHED" },
  });
}

describe("error.dueForReview — nextReviewAt three shapes (UI feedback B)", () => {
  it("dueToday non-empty: returns entries; nextReviewAt is null (frontend renders list)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const pastDue = new Date(Date.now() - 60_000);
    const due = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      nextReviewAt: pastDue,
    });
    // A future ACTIVE entry must NOT appear in nextReviewAt while dueToday is
    // non-empty — spec §5.1.4 contract.
    const q2 = await makeQuestion("future entry");
    await seedErrorBookEntry({
      userId: u.id,
      questionId: q2.id,
      status: "ACTIVE",
      nextReviewAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(1);
    expect(dueToday[0]!.id).toBe(due.id);
    expect(nextReviewAt).toBeNull();
  });

  it("dueToday empty + future ACTIVE exists: nextReviewAt = nearest future entry's nextReviewAt", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const nearFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const farFuture = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    // nearest is the 5d entry; farthest is the 20d entry.
    await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      nextReviewAt: farFuture,
    });
    const q2 = await makeQuestion("nearer");
    await seedErrorBookEntry({
      userId: u.id,
      questionId: q2.id,
      status: "ACTIVE",
      nextReviewAt: nearFuture,
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).not.toBeNull();
    // Timestamps round-trip through tRPC superjson; compare epoch ms.
    expect(new Date(nextReviewAt!).getTime()).toBe(nearFuture.getTime());
  });

  it("dueToday empty + no future ACTIVE: nextReviewAt is null (frontend renders empty copy)", async () => {
    const u = await seedUserWithBalance(0);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).toBeNull();
  });

  it("ARCHIVED entry excluded from dueToday even when nextReviewAt <= now", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      // Deliberately past-due, but ARCHIVED → should not surface.
      nextReviewAt: new Date(Date.now() - 60_000),
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).toBeNull();
  });

  it("ARCHIVED entry also excluded from the future-entry probe (would-be nearest)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    // Archived entry with a future nextReviewAt (artificial — runtime would
    // null it on archive(), but we set it explicitly to make sure the query
    // filter excludes ARCHIVED regardless).
    await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).toBeNull();
  });

  it("DELETED entry excluded from both dueToday and the future probe", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
      // Same artificial setup as ARCHIVED case — DELETED rows in DB should
      // never surface through any student-facing path.
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).toBeNull();
  });

  it("cross-user isolation: B doesn't see A's due entries", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const a = await seedUserWithBalance(0);
    const b = await seedUserWithBalance(0);
    await seedErrorBookEntry({
      userId: a.id,
      questionId,
      status: "ACTIVE",
      nextReviewAt: new Date(Date.now() - 60_000),
    });

    const callerB = appRouter.createCaller(makeCtx(b.id));
    const { dueToday, nextReviewAt } = await callerB.error.dueForReview({});
    expect(dueToday).toHaveLength(0);
    expect(nextReviewAt).toBeNull();
  });
});
