import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { ComplianceRejectedError } from "@zhijiao/ai";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
} from "./_helpers/error-book-fixtures";

// Mock the AI client so each test can swap the diagnoseError behaviour without
// hitting a real model adapter. The default mock is the happy path; tests that
// need adverse cases override via the module-mock's stored ref.
const aiMockRef = {
  diagnoseError: vi.fn(async (_input: unknown) => ({
    rootCause: "CALCULATION_SLIP" as const,
    reasoning: "Mock diagnosis: 学生移项符号搞反。",
    suggestedKnowledgePoints: ["一元一次方程", "移项"],
    modelCallId: "mock-call-id",
  })),
};

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    diagnoseError: (input: unknown) => aiMockRef.diagnoseError(input),
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  // Reset to happy path between tests.
  aiMockRef.diagnoseError = vi.fn(async (_input: unknown) => ({
    rootCause: "CALCULATION_SLIP" as const,
    reasoning: "Mock diagnosis.",
    suggestedKnowledgePoints: ["mock-kp"],
    modelCallId: "mock-call-id",
  }));
});
afterAll(async () => {
  await redis.quit();
});

describe("error.diagnose", () => {
  it("happy path: charges 1 credit, creates ACTIVE entry, returns entryId (UI feedback A)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const reqId = "11111111-1111-4111-8111-111111111111";

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: reqId,
    });

    // Return shape — entryId is the contract for ErrorAnalysisCard.
    expect(r.entryId).toBeTruthy();
    expect(r.rootCause).toBe("CALCULATION_SLIP");
    expect(r.rootCauseReasoning).toContain("Mock");
    expect(r.suggestedKnowledgePoints).toEqual(["mock-kp"]);
    expect(r.nextActions).toEqual([
      "GENERATE_VARIANTS",
      "REVIEW_LATER",
      "ASK_TUTOR",
    ]);

    // DB-truth: ACTIVE entry persisted with the returned id.
    const entry = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: r.entryId },
    });
    expect(entry.status).toBe("ACTIVE");
    expect(entry.userId).toBe(u.id);
    expect(entry.questionId).toBe(questionId);
    expect(entry.lastDiagnoseCallId).toBe("mock-call-id");
    expect(entry.nextReviewAt).not.toBeNull();

    // Billing-truth: 1 credit debited; ledger row idemKey matches contract.
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(4);
    const debit = await prisma.creditLedger.findUniqueOrThrow({
      where: { idemKey: `debit:error_analysis:${u.id}:${reqId}` },
    });
    expect(debit.delta).toBe(-1);
    expect(debit.actionKind).toBe("ERROR_ANALYSIS");
    expect(entry.diagnoseLedgerId).toBe(debit.id);
  });

  it("reuses existing ACTIVE entry for same (userId, questionId); preserves reviewCount and schedule", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const fixedNextReview = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const original = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      reviewCount: 3,
      nextReviewAt: fixedNextReview,
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "Original reasoning before re-diagnose.",
    });

    aiMockRef.diagnoseError = vi.fn(async () => ({
      rootCause: "READING_ERROR" as const,
      reasoning: "Updated mock reasoning.",
      suggestedKnowledgePoints: [],
      modelCallId: "mock-call-2",
    }));

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(r.entryId).toBe(original.id); // reuse, not new

    const all = await prisma.errorBookEntry.findMany({
      where: { userId: u.id, questionId },
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.rootCause).toBe("READING_ERROR");
    expect(all[0]!.rootCauseReasoning).toBe("Updated mock reasoning.");
    // Schedule preserved — re-diagnose does NOT roll back review progress.
    expect(all[0]!.reviewCount).toBe(3);
    expect(all[0]!.nextReviewAt!.getTime()).toBe(fixedNextReview.getTime());
  });

  it("resurrects ARCHIVED entry: status flips to ACTIVE; nextReviewAt re-seeded when previously null", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const archived = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      reviewCount: 2,
      nextReviewAt: null, // archive() clears this at runtime
    });

    const beforeMs = Date.now();
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: "33333333-3333-4333-8333-333333333333",
    });
    const afterMs = Date.now();
    expect(r.entryId).toBe(archived.id); // same row, not new

    const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: archived.id },
    });
    expect(reloaded.status).toBe("ACTIVE");
    expect(reloaded.reviewCount).toBe(2); // schedule history kept
    expect(reloaded.nextReviewAt).not.toBeNull();
    const nrMs = reloaded.nextReviewAt!.getTime();
    expect(nrMs).toBeGreaterThanOrEqual(beforeMs + 24 * 60 * 60 * 1000);
    expect(nrMs).toBeLessThanOrEqual(afterMs + 24 * 60 * 60 * 1000);
  });

  it("creates NEW entry when same (userId, questionId) has DELETED row (terminal not resurrected)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const dead = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: "44444444-4444-4444-8444-444444444444",
    });
    expect(r.entryId).not.toBe(dead.id);

    const all = await prisma.errorBookEntry.findMany({
      where: { userId: u.id, questionId },
      orderBy: { createdAt: "asc" },
    });
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(dead.id);
    expect(all[0]!.status).toBe("DELETED"); // terminal preserved
    expect(all[1]!.id).toBe(r.entryId);
    expect(all[1]!.status).toBe("ACTIVE");
  });

  it("concurrent diagnose (same user/question, different cri): exactly 1 ACTIVE entry; both calls charged", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);

    const caller = appRouter.createCaller(makeCtx(u.id));
    const [r1, r2] = await Promise.all([
      caller.error.diagnose({
        questionId,
        clientRequestId: "55555555-5555-4555-8555-555555555555",
      }),
      caller.error.diagnose({
        questionId,
        clientRequestId: "66666666-6666-4666-8666-666666666666",
      }),
    ]);
    expect(r1.entryId).toBe(r2.entryId);

    const all = await prisma.errorBookEntry.findMany({
      where: { userId: u.id, questionId },
    });
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("ACTIVE");

    // Both calls received AI service → both charged 1 credit.
    const debits = await prisma.creditLedger.findMany({
      where: { actionKind: "ERROR_ANALYSIS", walletId: u.walletId },
    });
    expect(debits).toHaveLength(2);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(3); // 5 - 2
  });

  it("ComplianceRejectedError: debit kept; metadata.compensationStatus = not_compensated_whitelisted; no compensation row", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);

    aiMockRef.diagnoseError = vi.fn(async () => {
      throw new ComplianceRejectedError(["押中"], "ERROR_ANALYSIS");
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.diagnose({
        questionId,
        clientRequestId: "77777777-7777-4777-8777-777777777777",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { reason: "COMPLIANCE_REJECTED" },
    });

    // Debit row exists, metadata marks whitelist non-comp; no COMPENSATION row.
    const debits = await prisma.creditLedger.findMany({
      where: { actionKind: "ERROR_ANALYSIS", kind: "DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.metadata).toMatchObject({
      compensationStatus: "not_compensated_whitelisted",
      errorClass: "ComplianceRejectedError",
    });

    const comps = await prisma.creditLedger.count({ where: { kind: "COMPENSATION" } });
    expect(comps).toBe(0);

    // Balance reflects the (kept) debit: 5 - 1 = 4.
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(4);

    // No ErrorBookEntry was created (AI threw before upsert).
    const entries = await prisma.errorBookEntry.findMany({ where: { userId: u.id } });
    expect(entries).toHaveLength(0);
  });

  it("non-compliance AI error: COMPENSATION ledger row written; balance restored to baseline", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);

    aiMockRef.diagnoseError = vi.fn(async () => {
      throw new Error("network down");
    });

    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.diagnose({
        questionId,
        clientRequestId: "88888888-8888-4888-8888-888888888888",
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      cause: { reason: "ERROR_ANALYSIS_INTERNAL" },
    });

    const debits = await prisma.creditLedger.findMany({
      where: { actionKind: "ERROR_ANALYSIS", kind: "DEBIT" },
    });
    expect(debits).toHaveLength(1);

    const comps = await prisma.creditLedger.findMany({
      where: { kind: "COMPENSATION" },
    });
    expect(comps).toHaveLength(1);
    expect(comps[0]!.delta).toBe(1);
    expect(comps[0]!.refTable).toBe("credit_ledger");
    expect(comps[0]!.refId).toBe(debits[0]!.id);

    // Balance restored: -1 (debit) + 1 (compensation) = 0 net.
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(5);
  });

  it("missing clientRequestId: BAD_REQUEST / CLIENT_REQUEST_ID_REQUIRED; no charge", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.error.diagnose({ questionId } as unknown as {
        questionId: string;
        clientRequestId: string;
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
    });

    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(w.balance).toBe(5);
    const debits = await prisma.creditLedger.count({
      where: { actionKind: "ERROR_ANALYSIS" },
    });
    expect(debits).toBe(0);
  });
});
