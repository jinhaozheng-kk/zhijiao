// Plan 8 hotfix (P1 from review): error.diagnose 必须在扣费前校验 questionId 归属。
// 守门 4 个场景：
//   1) USER_ADHOC owned by current user → success + charge
//   2) USER_ADHOC owned by other user  → NOT_FOUND/QUESTION_NOT_FOUND + no DEBIT
//   3) PUBLISHED question               → success + charge（公共题不限）
//   4) Non-existent questionId         → NOT_FOUND/QUESTION_NOT_FOUND + no DEBIT
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  genCuid,
} from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async diagnoseError(_input: unknown) {
      return {
        rootCause: "CALCULATION_SLIP" as const,
        reasoning: "Mock diagnosis.",
        suggestedKnowledgePoints: ["mock-kp"],
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

async function ensureMathSubject(): Promise<{ id: string }> {
  return prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
    select: { id: true },
  });
}

async function seedUserAdhocQuestion(userId: string, stem: string): Promise<string> {
  const math = await ensureMathSubject();
  const q = await prisma.question.create({
    data: {
      subjectId: math.id,
      stemMd: stem,
      type: "ESSAY",
      status: "DRAFT",
      source: "USER_ADHOC",
      createdByUserId: userId,
      normalizedStemHash: stem.toLowerCase().slice(0, 32).padEnd(32, "0"),
    },
  });
  return q.id;
}

describe("error.diagnose questionId access control (Plan 8 hotfix P1)", () => {
  it("USER_ADHOC owned by current user → success + 1 credit charged", async () => {
    const u = await seedUserWithBalance(5);
    const qid = await seedUserAdhocQuestion(u.id, "USER_ADHOC q owned by me");

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId: qid,
      clientRequestId: crypto.randomUUID(),
    });

    expect(r.entryId).toBeTruthy();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(4); // 5 - 1
  });

  it("USER_ADHOC owned by another user → NOT_FOUND/QUESTION_NOT_FOUND + no DEBIT + no entry", async () => {
    const owner = await seedUserWithBalance(5);
    const attacker = await seedUserWithBalance(5);
    const qid = await seedUserAdhocQuestion(owner.id, "B's private adhoc q");

    const caller = appRouter.createCaller(makeCtx(attacker.id));
    let err: unknown;
    try {
      await caller.error.diagnose({
        questionId: qid,
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("NOT_FOUND");
    expect((trpc.cause as { reason?: string } | undefined)?.reason).toBe("QUESTION_NOT_FOUND");

    // 关键：attacker 的钱包未动 + 无 DEBIT
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: attacker.id } });
    expect(wallet.balance).toBe(5);
    const debits = await prisma.creditLedger.count({
      where: { walletId: attacker.walletId, kind: "DEBIT", actionKind: "ERROR_ANALYSIS" },
    });
    expect(debits).toBe(0);

    // 关键：未为 attacker 建 entry
    const entries = await prisma.errorBookEntry.count({ where: { userId: attacker.id } });
    expect(entries).toBe(0);
  });

  it("PUBLISHED question (公共题库) → success + 1 credit charged", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);

    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.error.diagnose({
      questionId,
      clientRequestId: crypto.randomUUID(),
    });

    expect(r.entryId).toBeTruthy();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(4);
  });

  it("Non-existent questionId → NOT_FOUND/QUESTION_NOT_FOUND + no DEBIT", async () => {
    const u = await seedUserWithBalance(5);
    const fakeId = genCuid("does-not-exist");

    const caller = appRouter.createCaller(makeCtx(u.id));
    let err: unknown;
    try {
      await caller.error.diagnose({
        questionId: fakeId,
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("NOT_FOUND");
    expect((trpc.cause as { reason?: string } | undefined)?.reason).toBe("QUESTION_NOT_FOUND");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(5);
    const debits = await prisma.creditLedger.count({
      where: { walletId: u.walletId, kind: "DEBIT", actionKind: "ERROR_ANALYSIS" },
    });
    expect(debits).toBe(0);
  });
});
