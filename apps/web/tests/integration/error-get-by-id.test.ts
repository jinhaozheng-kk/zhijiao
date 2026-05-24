import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
  genCuid,
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

describe("error.getById", () => {
  it("happy path: returns entry + question (incl. KPs and answer) + variantGroups (empty when none)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      rootCause: "CALCULATION_SLIP",
      rootCauseReasoning: "Slip on移项.",
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const res = await caller.error.getById({ entryId: entry.id });

    expect(res.entry.id).toBe(entry.id);
    expect(res.entry.rootCause).toBe("CALCULATION_SLIP");
    expect(res.entry.rootCauseReasoning).toBe("Slip on移项.");
    expect(res.question.id).toBe(questionId);
    expect(res.question.stemMd).toContain("2x + 5 = 13");
    expect(res.question.answer?.contentMd).toBe("x = 4");
    expect(res.question.knowledgePoints).toHaveLength(1);
    expect(res.question.knowledgePoints[0]!.name).toBe("一元一次方程");
    expect(res.variantGroups).toEqual([]);
  });

  it("nonexistent entryId (valid cuid, no DB row): NOT_FOUND/ENTRY_NOT_FOUND", async () => {
    const u = await seedUserWithBalance(0);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const ghost = genCuid("ghost");
    // Sanity check the cuid is syntactically valid (passes the zod gate).
    expect(ghost).toMatch(/^c[a-z0-9]{8,}$/);
    // And confirm absence in DB to ensure we exercise the DB-miss branch.
    expect(
      await prisma.errorBookEntry.findUnique({ where: { id: ghost } }),
    ).toBeNull();

    await expect(
      caller.error.getById({ entryId: ghost }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "ENTRY_NOT_FOUND" },
    });
  });

  it("cross-user entry: NOT_FOUND/ENTRY_NOT_FOUND (NOT FORBIDDEN — anti existence leak)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const a = await seedUserWithBalance(0);
    const b = await seedUserWithBalance(0);
    const aEntry = await seedErrorBookEntry({
      userId: a.id,
      questionId,
      status: "ACTIVE",
    });

    const callerB = appRouter.createCaller(makeCtx(b.id));
    const err = await callerB.error
      .getById({ entryId: aEntry.id })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
    // Defensive: ensure validateEntryOwnership did not leak a FORBIDDEN
    // anywhere (would tell a probe "the entry exists, you just can't see it").
    expect(err.code).not.toBe("FORBIDDEN");
  });

  it("DELETED entry: NOT_FOUND/ENTRY_NOT_FOUND (terminal — invisible to student surfaces)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const deleted = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.getById({ entryId: deleted.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "ENTRY_NOT_FOUND" },
    });
  });

  it("malformed entryId: BAD_REQUEST/ENTRY_ID_REQUIRED (zod gate fires before DB)", async () => {
    const u = await seedUserWithBalance(0);
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.getById({ entryId: "not-a-cuid" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { reason: "ENTRY_ID_REQUIRED" },
    });
  });
});
