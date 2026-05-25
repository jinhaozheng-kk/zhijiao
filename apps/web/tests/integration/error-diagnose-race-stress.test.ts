// Plan 4 hotfix (surfaced by Plan 9 Task 7): upsertEntryOnDiagnose moved out
// of $transaction so the P2002 catch's re-read doesn't run inside an aborted
// tx (Postgres 25P02). Locks the invariant: under heavy concurrency on the
// same (userId, questionId), all calls succeed, exactly 1 ACTIVE entry, no
// 25P02 PrismaClientUnknownRequestError escapes.
//
// The pre-existing tests/integration/error-diagnose.test.ts has a "concurrent
// diagnose" case for 2-way race; this one tightens to 10-way which would
// have failed reliably on the buggy in-tx implementation.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { redis, seedTestSubjectAndQuestion, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async diagnoseError(_input: unknown) {
      return {
        rootCause: "CALCULATION_SLIP" as const,
        reasoning: "Race stress mock.",
        suggestedKnowledgePoints: ["mock-kp"],
        modelCallId: "mock-call-id",
      };
    },
  }),
}));

const { appRouter } = await import("@/server/routers/_root");
const { makeCtx } = await import("./_helpers/error-book-fixtures");

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); await prisma.$disconnect(); });

describe("error.diagnose race stress (Plan 4 hotfix)", () => {
  it("10 concurrent diagnose calls (same user, same question) → all succeed, exactly 1 ACTIVE entry, no 25P02", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(20); // 10 calls × 1 credit budget
    const caller = appRouter.createCaller(makeCtx(u.id));

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        caller.error.diagnose({
          questionId,
          clientRequestId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
        }),
      ),
    );

    // All 10 calls succeeded
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.entryId).toBeTruthy();
      expect(r.rootCause).toBe("CALCULATION_SLIP");
    }

    // All 10 calls converged on the same entry id (partial unique idx invariant)
    const entryIds = new Set(results.map((r) => r.entryId));
    expect(entryIds.size).toBe(1);

    // DB-truth: exactly 1 ACTIVE entry for this (user, question)
    const entries = await prisma.errorBookEntry.findMany({
      where: { userId: u.id, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe([...entryIds][0]);

    // All 10 calls were charged
    const debits = await prisma.creditLedger.count({
      where: { walletId: u.walletId, kind: "DEBIT", actionKind: "ERROR_ANALYSIS" },
    });
    expect(debits).toBe(10);
  });
});
