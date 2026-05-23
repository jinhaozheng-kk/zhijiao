import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { ComplianceRejectedError } from "@zhijiao/ai";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
  genCuid,
} from "./_helpers/error-book-fixtures";

// Mock the AI client. Default is the happy path (3 items L1/L2/L3); each
// adverse case reassigns the mock. Typed Promise<unknown> so adverse-case
// reassignments don't have to match the happy-path shape exactly.
type GenerateVariantsFn = (input: unknown) => Promise<unknown>;
const aiMockRef: { generateVariants: GenerateVariantsFn } = {
  generateVariants: vi.fn<Parameters<GenerateVariantsFn>, ReturnType<GenerateVariantsFn>>(
    async (_input) => ({
      items: [
        {
          level: "L1" as const,
          stemMd: "L1: 解方程 3x + 7 = 19。",
          solutionMd: "x = 4",
          knowledgePointHints: ["一元一次方程"],
        },
        {
          level: "L2" as const,
          stemMd: "L2: 已知 3x + 7 = 19，求 6x - 1。",
          solutionMd: "由 x = 4 代入得 23",
          knowledgePointHints: ["一元一次方程", "代数式求值"],
        },
        {
          level: "L3" as const,
          stemMd: "L3: 小明买 3 包薯片和 1 瓶 7 元水共 19 元，每包多少钱？",
          solutionMd: "设薯片每包 x 元，3x+7=19，x=4",
          knowledgePointHints: ["一次方程应用"],
        },
      ],
      modelCallId: "mock-variant-call-id",
    }),
  ),
};

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    generateVariants: (input: unknown) => aiMockRef.generateVariants(input),
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  // Reset to the happy-path mock between tests so adverse-case state doesn't
  // leak across test boundaries.
  aiMockRef.generateVariants = vi.fn<
    Parameters<GenerateVariantsFn>,
    ReturnType<GenerateVariantsFn>
  >(async (_input) => ({
    items: [
      { level: "L1" as const, stemMd: "L1 mock", solutionMd: "sol", knowledgePointHints: [] },
      { level: "L2" as const, stemMd: "L2 mock", solutionMd: "sol", knowledgePointHints: [] },
      { level: "L3" as const, stemMd: "L3 mock", solutionMd: "sol", knowledgePointHints: [] },
    ],
    modelCallId: "mock-variant-call-id",
  }));
});
afterAll(async () => {
  await redis.quit();
});

describe("variant.generateForEntry", () => {
  describe("Blocker 1: entry 校验必须在扣费之前", () => {
    // These four cases are the hard pass-gate for Task 5. The shared assertion
    // shape: NOT_FOUND / ENTRY_NOT_FOUND (or BAD_REQUEST / ENTRY_ID_REQUIRED
    // for malformed input) + ZERO DEBIT ledger rows + balance preserved.
    // Any one of these failing means the middleware chain order is reversed
    // (chargeMiddleware running before validateEntryOwnership).

    async function expectNoDebit(walletId: string, expectedBalance: number) {
      const w = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
      expect(w.balance).toBe(expectedBalance);
      const debits = await prisma.creditLedger.findMany({
        where: { walletId, kind: "DEBIT" },
      });
      expect(debits).toHaveLength(0);
    }

    it("ghost entryId (valid cuid, not in DB): NOT_FOUND + no DEBIT row + balance unchanged", async () => {
      const u = await seedUserWithBalance(100);
      const ghostEntryId = genCuid("ghost");
      expect(ghostEntryId).toMatch(/^c[a-z0-9]{8,}$/);
      expect(
        await prisma.errorBookEntry.findUnique({ where: { id: ghostEntryId } }),
      ).toBeNull();

      const caller = appRouter.createCaller(makeCtx(u.id));
      const err = await caller.variant
        .generateForEntry({
          entryId: ghostEntryId,
          clientRequestId: "11111111-1111-4111-8111-111111111111",
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      await expectNoDebit(u.walletId, 100);
    });

    it("cross-user entryId: NOT_FOUND (NOT FORBIDDEN — anti existence leak) + no DEBIT + balance unchanged", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const a = await seedUserWithBalance(100);
      const b = await seedUserWithBalance(0);
      const entryOfB = await seedErrorBookEntry({
        userId: b.id,
        questionId,
        status: "ACTIVE",
      });

      const callerA = appRouter.createCaller(makeCtx(a.id));
      const err = await callerA.variant
        .generateForEntry({
          entryId: entryOfB.id,
          clientRequestId: "22222222-2222-4222-8222-222222222222",
        })
        .catch((e) => e);

      expect(err.code).toBe("NOT_FOUND");
      expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      // Defensive: the response MUST NOT be FORBIDDEN (would tell a probe
      // "this entry exists, just isn't yours").
      expect(err.code).not.toBe("FORBIDDEN");
      await expectNoDebit(a.walletId, 100);
    });

    it("malformed entryId: BAD_REQUEST/ENTRY_ID_REQUIRED + no DEBIT + balance unchanged", async () => {
      const u = await seedUserWithBalance(100);
      const caller = appRouter.createCaller(makeCtx(u.id));
      const err = await caller.variant
        .generateForEntry({
          entryId: "not-a-cuid",
          clientRequestId: "33333333-3333-4333-8333-333333333333",
        })
        .catch((e) => e);

      expect(err.code).toBe("BAD_REQUEST");
      expect(err.cause?.reason).toBe("ENTRY_ID_REQUIRED");
      await expectNoDebit(u.walletId, 100);
    });

    it("DELETED entryId: NOT_FOUND/ENTRY_NOT_FOUND + no DEBIT + balance unchanged", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const dead = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "DELETED",
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      const err = await caller.variant
        .generateForEntry({
          entryId: dead.id,
          clientRequestId: "44444444-4444-4444-8444-444444444444",
        })
        .catch((e) => e);

      expect(err.code).toBe("NOT_FOUND");
      expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      await expectNoDebit(u.walletId, 100);
    });
  });

  describe("happy path & business", () => {
    it("ACTIVE entry + 100 credits: charges 3, creates VariantGroup + 3 VariantItems (L1/L2/L3 sorted by position)", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      const reqId = "55555555-5555-4555-8555-555555555555";
      const { group } = await caller.variant.generateForEntry({
        entryId: entry.id,
        clientRequestId: reqId,
      });

      // Return shape
      expect(group.id).toBeTruthy();
      expect(group.entryId).toBe(entry.id);
      expect(group.creditsCost).toBe(3);
      expect(group.items).toHaveLength(3);
      expect(group.items.map((it) => it.level)).toEqual(["L1", "L2", "L3"]);
      // Position sorted
      expect(group.items.map((it) => it.position)).toEqual([1, 2, 3]);

      // Billing-truth: 3 credits debited; idemKey matches the chargeMiddleware
      // naming contract for VARIANT_GROUP_GEN.
      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(97);
      const debit = await prisma.creditLedger.findUniqueOrThrow({
        where: { idemKey: `debit:variant_group_gen:${u.id}:${reqId}` },
      });
      expect(debit.delta).toBe(-3);
      expect(debit.actionKind).toBe("VARIANT_GROUP_GEN");

      // ctx.debit injection — VariantGroup.debitLedgerId must equal the
      // DEBIT row id (proves chargeMiddleware injected ctx.debit and that
      // the mutation body wrote it through).
      const dbGroup = await prisma.variantGroup.findUniqueOrThrow({
        where: { id: group.id },
      });
      expect(dbGroup.debitLedgerId).toBe(debit.id);
      expect(dbGroup.modelCallId).toBe("mock-variant-call-id");
    });

    it("ARCHIVED entry: also allowed; charges 3 + generates (entry.status unchanged by variant generation)", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ARCHIVED",
        nextReviewAt: null,
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      const { group } = await caller.variant.generateForEntry({
        entryId: entry.id,
        clientRequestId: "66666666-6666-4666-8666-666666666666",
      });
      expect(group.items).toHaveLength(3);

      // ARCHIVED entry stays ARCHIVED — generating variants is not the same
      // signal as re-engaging the question (that's error.diagnose's job).
      const reloaded = await prisma.errorBookEntry.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(reloaded.status).toBe("ARCHIVED");
      expect(reloaded.nextReviewAt).toBeNull();

      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(97);
    });
  });

  describe("compensation", () => {
    it("non-compliance AI error: COMPENSATION row written; balance restored to 100; no VariantGroup", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
      });

      aiMockRef.generateVariants = vi.fn<
        Parameters<GenerateVariantsFn>,
        ReturnType<GenerateVariantsFn>
      >(async (_input) => {
        throw new Error("network down");
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      await expect(
        caller.variant.generateForEntry({
          entryId: entry.id,
          clientRequestId: "77777777-7777-4777-8777-777777777777",
        }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        cause: { reason: "VARIANT_GEN_INTERNAL" },
      });

      const debits = await prisma.creditLedger.findMany({
        where: { actionKind: "VARIANT_GROUP_GEN", kind: "DEBIT" },
      });
      expect(debits).toHaveLength(1);
      const comps = await prisma.creditLedger.findMany({
        where: { kind: "COMPENSATION" },
      });
      expect(comps).toHaveLength(1);
      expect(comps[0]!.delta).toBe(3);
      expect(comps[0]!.refId).toBe(debits[0]!.id);

      // Balance restored to baseline.
      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(100);

      // No VariantGroup persisted (AI failed before $transaction).
      const groups = await prisma.variantGroup.findMany({ where: { userId: u.id } });
      expect(groups).toHaveLength(0);
    });

    it("ComplianceRejectedError: debit kept; metadata marks not_compensated_whitelisted; no comp row; no VariantGroup; balance 97", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
      });

      aiMockRef.generateVariants = vi.fn<
        Parameters<GenerateVariantsFn>,
        ReturnType<GenerateVariantsFn>
      >(async (_input) => {
        throw new ComplianceRejectedError(["押中"], "VARIANT_GROUP_GEN");
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      await expect(
        caller.variant.generateForEntry({
          entryId: entry.id,
          clientRequestId: "88888888-8888-4888-8888-888888888888",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { reason: "COMPLIANCE_REJECTED" },
      });

      const debits = await prisma.creditLedger.findMany({
        where: { actionKind: "VARIANT_GROUP_GEN", kind: "DEBIT" },
      });
      expect(debits).toHaveLength(1);
      expect(debits[0]!.metadata).toMatchObject({
        compensationStatus: "not_compensated_whitelisted",
        errorClass: "ComplianceRejectedError",
      });
      const comps = await prisma.creditLedger.count({ where: { kind: "COMPENSATION" } });
      expect(comps).toBe(0);

      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(97); // debit kept

      const groups = await prisma.variantGroup.findMany({ where: { userId: u.id } });
      expect(groups).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("same clientRequestId retry: 2nd call returns CONFLICT/ACTION_IDEMPOTENCY_HIT; no extra VariantGroup; no extra charge", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      const reqId = "99999999-9999-4999-8999-999999999999";

      const r1 = await caller.variant.generateForEntry({
        entryId: entry.id,
        clientRequestId: reqId,
      });
      expect(r1.group.items).toHaveLength(3);

      // Second call same cri → idemKey hits UNIQUE in CreditLedger; the
      // middleware translates ActionAlreadyChargedError into CONFLICT.
      await expect(
        caller.variant.generateForEntry({
          entryId: entry.id,
          clientRequestId: reqId,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        cause: { reason: "ACTION_IDEMPOTENCY_HIT" },
      });

      // Only 1 DEBIT, only 1 VariantGroup, balance reflects single charge.
      const debits = await prisma.creditLedger.count({
        where: { actionKind: "VARIANT_GROUP_GEN", kind: "DEBIT" },
      });
      expect(debits).toBe(1);
      const groups = await prisma.variantGroup.findMany({ where: { userId: u.id } });
      expect(groups).toHaveLength(1);
      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(97);
    });

    it("missing clientRequestId: BAD_REQUEST/CLIENT_REQUEST_ID_REQUIRED; no charge; no VariantGroup", async () => {
      const { questionId } = await seedTestSubjectAndQuestion();
      const u = await seedUserWithBalance(100);
      const entry = await seedErrorBookEntry({
        userId: u.id,
        questionId,
        status: "ACTIVE",
      });

      const caller = appRouter.createCaller(makeCtx(u.id));
      await expect(
        caller.variant.generateForEntry({ entryId: entry.id } as unknown as {
          entryId: string;
          clientRequestId: string;
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
      });

      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(100);
      const groups = await prisma.variantGroup.findMany({ where: { userId: u.id } });
      expect(groups).toHaveLength(0);
    });
  });

  describe("middleware chain order assertion", () => {
    it("missing both entryId AND clientRequestId: throws ENTRY_ID_REQUIRED (not CLIENT_REQUEST_ID_REQUIRED) — proves validateEntryOwnership runs before chargeMiddleware", async () => {
      const u = await seedUserWithBalance(100);
      const caller = appRouter.createCaller(makeCtx(u.id));
      const err = await caller.variant
        .generateForEntry({} as unknown as {
          entryId: string;
          clientRequestId: string;
        })
        .catch((e) => e);

      // Order is the point: validateEntryOwnership's entryId gate fires
      // BEFORE chargeMiddleware's clientRequestId gate. If middleware
      // ordering is reversed, this would be CLIENT_REQUEST_ID_REQUIRED.
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.cause?.reason).toBe("ENTRY_ID_REQUIRED");
      expect(err.cause?.reason).not.toBe("CLIENT_REQUEST_ID_REQUIRED");

      // No charge regardless.
      const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(w.balance).toBe(100);
    });
  });
});
