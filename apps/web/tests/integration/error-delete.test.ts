import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
} from "./_helpers/error-book-fixtures";

// The "delete then re-diagnose creates a NEW entry" case calls
// error.diagnose, which goes through chargeMiddleware + the AI router.
// Mock the AI client so we don't depend on a real adapter for what is
// fundamentally a state-machine assertion.
vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async diagnoseError(_input: unknown) {
      return {
        rootCause: "CALCULATION_SLIP" as const,
        reasoning: "Mock reasoning after re-diagnose.",
        suggestedKnowledgePoints: ["一元一次方程"],
        modelCallId: "mock-call-id",
      };
    },
  }),
}));

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

describe("error.delete — Blocker 2: DELETED is terminal", () => {
  it("delete ACTIVE entry: status → DELETED, nextReviewAt cleared, returns {ok:true}", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.delete({ entryId: entry.id });
    expect(r).toEqual({ ok: true });

    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(reloaded.status).toBe("DELETED");
    expect(reloaded.nextReviewAt).toBeNull();
  });

  describe("after delete: entry is invisible to every student-facing surface", () => {
    async function seedAndDelete() {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(0);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
        nextReviewAt: new Date(Date.now() - 60_000), // would otherwise be due today
      });
      const caller = appRouter.createCaller(makeCtx(u.id));
      await caller.error.delete({ entryId: entry.id });
      return { userId: u.id, questionId, entryId: entry.id, caller };
    }

    it("error.list() default (ACTIVE) does not include the entry", async () => {
      const { caller, entryId } = await seedAndDelete();
      const { entries } = await caller.error.list({ limit: 50 });
      expect(entries.find((e) => e.id === entryId)).toBeUndefined();
      expect(entries).toHaveLength(0);
    });

    it('error.list({ status: "ACTIVE" }) does not include the entry', async () => {
      const { caller, entryId } = await seedAndDelete();
      const { entries } = await caller.error.list({
        status: "ACTIVE",
        limit: 50,
      });
      expect(entries.find((e) => e.id === entryId)).toBeUndefined();
    });

    it('error.list({ status: "ARCHIVED" }) does not include the entry', async () => {
      const { caller, entryId } = await seedAndDelete();
      const { entries } = await caller.error.list({
        status: "ARCHIVED",
        limit: 50,
      });
      expect(entries.find((e) => e.id === entryId)).toBeUndefined();
    });

    it('error.list({ status: "DELETED" }) is rejected by zod → BAD_REQUEST', async () => {
      const { caller } = await seedAndDelete();
      await expect(
        caller.error.list({ status: "DELETED" } as unknown as {
          status: "ACTIVE" | "ARCHIVED";
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      await expect(
        caller.error.list({ status: "DELETED" } as unknown as {
          status: "ACTIVE" | "ARCHIVED";
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("error.getById → NOT_FOUND/ENTRY_NOT_FOUND", async () => {
      const { caller, entryId } = await seedAndDelete();
      await expect(
        caller.error.getById({ entryId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    });

    it("error.dueForReview does NOT surface the entry (neither dueToday nor nextReviewAt)", async () => {
      const { caller, entryId } = await seedAndDelete();
      const { dueToday, nextReviewAt } = await caller.error.dueForReview({});
      expect(dueToday.find((e) => e.id === entryId)).toBeUndefined();
      expect(dueToday).toHaveLength(0);
      expect(nextReviewAt).toBeNull();
    });

    it("error.markReviewed → NOT_FOUND/ENTRY_NOT_FOUND", async () => {
      const { caller, entryId } = await seedAndDelete();
      await expect(
        caller.error.markReviewed({ entryId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    });

    it("error.archive → NOT_FOUND/ENTRY_NOT_FOUND", async () => {
      const { caller, entryId } = await seedAndDelete();
      await expect(
        caller.error.archive({ entryId, archived: true }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    });

    it("error.delete (second time) → NOT_FOUND/ENTRY_NOT_FOUND (terminal, not resurrectable)", async () => {
      const { caller, entryId } = await seedAndDelete();
      await expect(
        caller.error.delete({ entryId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    });
  });

  it("after delete: error.diagnose same (userId, questionId) creates a NEW entry (partial unique allows coexistence)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    // Need balance for the 1-credit diagnose charge.
    const u = await seedUserWithBalance(5);

    const original = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await caller.error.delete({ entryId: original.id });

    // Re-diagnose the SAME question. DELETED row stays in DB; a NEW ACTIVE
    // row is created. Partial unique idx WHERE status IN (ACTIVE,ARCHIVED)
    // allows the two to coexist.
    const reqId = "33333333-3333-4333-8333-333333333333";
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: reqId,
    });
    expect(r.entryId).toBeTruthy();
    expect(r.entryId).not.toBe(original.id);

    const allRows = await prisma.errorBookEntry.findMany({
      where: { userId: u.id, questionId },
      orderBy: { createdAt: "asc" },
    });
    expect(allRows).toHaveLength(2);
    // Original kept its DELETED status (terminal — not resurrected).
    expect(allRows[0]!.id).toBe(original.id);
    expect(allRows[0]!.status).toBe("DELETED");
    // The new entry is ACTIVE.
    expect(allRows[1]!.id).toBe(r.entryId);
    expect(allRows[1]!.status).toBe("ACTIVE");
  });
});
