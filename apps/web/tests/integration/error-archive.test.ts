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

describe("error.archive", () => {
  it("ACTIVE → ARCHIVED: status flipped, nextReviewAt cleared", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    expect(entry.nextReviewAt).not.toBeNull();

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entry: after } = await caller.error.archive({
      entryId: entry.id,
      archived: true,
    });
    expect(after.status).toBe("ARCHIVED");
    expect(after.nextReviewAt).toBeNull();

    // DB-truth check.
    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.status).toBe("ARCHIVED");
    expect(reloaded.nextReviewAt).toBeNull();
  });

  it("ARCHIVED → ACTIVE (archived:false): nextReviewAt seeded at now+1d", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      nextReviewAt: null,
    });

    const beforeMs = Date.now();
    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entry: after } = await caller.error.archive({
      entryId: entry.id,
      archived: false,
    });
    const afterMs = Date.now();

    expect(after.status).toBe("ACTIVE");
    expect(after.nextReviewAt).not.toBeNull();
    // Should be between [beforeMs + 1d, afterMs + 1d] inclusive.
    const nr = new Date(after.nextReviewAt!).getTime();
    expect(nr).toBeGreaterThanOrEqual(beforeMs + 24 * 60 * 60 * 1000);
    expect(nr).toBeLessThanOrEqual(afterMs + 24 * 60 * 60 * 1000);
  });

  it("idempotent: second archive(true) on already-ARCHIVED is no-op (updatedAt unchanged)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      nextReviewAt: null,
    });
    const initialUpdatedAt = entry.updatedAt;

    const caller = appRouter.createCaller(makeCtx(u.id));
    // Wait a tick so any update WOULD bump updatedAt observably.
    await new Promise((r) => setTimeout(r, 25));
    const { entry: after } = await caller.error.archive({
      entryId: entry.id,
      archived: true,
    });
    expect(after.status).toBe("ARCHIVED");
    // updatedAt unchanged (idempotent short-circuit; no DB write).
    expect(new Date(after.updatedAt).getTime()).toBe(
      new Date(initialUpdatedAt).getTime(),
    );

    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
  });

  it("idempotent: second archive(false) on already-ACTIVE is no-op (updatedAt unchanged)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
    });
    const initialUpdatedAt = entry.updatedAt;

    const caller = appRouter.createCaller(makeCtx(u.id));
    await new Promise((r) => setTimeout(r, 25));
    await caller.error.archive({ entryId: entry.id, archived: false });
    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
  });

  it("DELETED entry: NOT_FOUND/ENTRY_NOT_FOUND (validateEntryOwnership blocks)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const deleted = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.archive({ entryId: deleted.id, archived: true }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "ENTRY_NOT_FOUND" },
    });
  });
});
