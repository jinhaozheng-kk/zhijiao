import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      return {
        restatement: "求 1+1。",
        knowledgePoints: ["加法基本运算"],
        steps: ["逐位相加"],
        pitfalls: [],
        finalAnswer: "2",
      };
    },
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-charged",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function seedUserWithBalance(balance: number): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor: false, persona: "STUDENT" },
  });
  if (balance > 0) {
    const w = await prisma.wallet.create({
      data: { userId: u.id, balance },
    });
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: balance,
        balanceAfter: balance,
        idemKey: `topup:bootstrap:${u.id}`,
      },
    });
  }
  return u.id;
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  // Plan 8: tutor.ask 改造后 body 调 upsertUserAdhocQuestion 需要 math subject 存在。
  // 不算行为回归 —— Plan 3 套件测的是扣费链路 + ledger，本 plan 加 Question 持久化要求 setup 配套。
  await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
});
afterAll(async () => {
  await redis.quit();
});

describe("chargedProcedure full chain via tutor.ask", () => {
  it("happy: balance -= 1 (cost for TUTOR_ASK); DEBIT ledger with idemKey debit:tutor_ask:<userId>:<uuid>", async () => {
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    const reqId = "11111111-1111-4111-8111-111111111111";
    const r = await caller.tutor.ask({
      clientRequestId: reqId,
      questionStem: "求 1+1=?",
      studentGrade: "G7",
    });
    expect(r.finalAnswer).toBe("2");

    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(4);

    const debit = await prisma.creditLedger.findUnique({
      where: { idemKey: `debit:tutor_ask:${userId}:${reqId}` },
    });
    expect(debit?.delta).toBe(-1);
    expect(debit?.actionKind).toBe("TUTOR_ASK");
    expect(debit?.balanceAfter).toBe(4);
  });

  it("INSUFFICIENT_BALANCE: balance=0 → PRECONDITION_FAILED with required/balance fields; no DEBIT row", async () => {
    const userId = await seedUserWithBalance(0);
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.tutor.ask({
        clientRequestId: "22222222-2222-4222-8222-222222222222",
        questionStem: "x",
        studentGrade: "G7",
      }),
    ).rejects.toMatchObject({
      cause: { reason: "INSUFFICIENT_BALANCE", required: 1, balance: 0 },
    });
    const debits = await prisma.creditLedger.count({
      where: { actionKind: "TUTOR_ASK" },
    });
    expect(debits).toBe(0);
  });

  it("CLIENT_REQUEST_ID_REQUIRED: missing clientRequestId is rejected before DB touched", async () => {
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    // Cast to bypass zod-typed input — the test simulates a buggy client.
    await expect(
      caller.tutor.ask({
        questionStem: "x",
        studentGrade: "G7",
      } as unknown as { questionStem: string; studentGrade: "G7"; clientRequestId: string }),
    ).rejects.toThrow();
    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(5); // no debit
  });

  it("non-UUID clientRequestId is rejected (zod input validation)", async () => {
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.tutor.ask({
        clientRequestId: "not-a-uuid",
        questionStem: "x",
        studentGrade: "G7",
      }),
    ).rejects.toThrow();
    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(5);
  });
});
