import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";

// Module-scoped counter the mock increments on every AI call so the test
// can assert idempotent retries don't re-trigger the upstream service.
let aiCalls = 0;
vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      aiCalls++;
      return {
        restatement: "demo",
        knowledgePoints: ["k"],
        steps: ["s"],
        pitfalls: [],
        finalAnswer: "42",
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
      sessionId: "s",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-idem",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function seedUserWithBalance(balance: number): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor: false, persona: "STUDENT" },
  });
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
  return u.id;
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  aiCalls = 0;
  // Plan 8: tutor.ask body 现调 upsertUserAdhocQuestion，需 math subject。
  await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
});
afterAll(async () => {
  await redis.quit();
});

describe("chargedProcedure idempotency", () => {
  it("same clientRequestId twice → second returns CONFLICT/ACTION_IDEMPOTENCY_HIT; balance -1 once; AI called once", async () => {
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    const reqId = "33333333-3333-4333-8333-333333333333";

    const r1 = await caller.tutor.ask({
      clientRequestId: reqId,
      questionStem: "x",
      studentGrade: "G7",
    });
    expect(r1.finalAnswer).toBe("42");

    await expect(
      caller.tutor.ask({
        clientRequestId: reqId,
        questionStem: "x",
        studentGrade: "G7",
      }),
    ).rejects.toMatchObject({ cause: { reason: "ACTION_IDEMPOTENCY_HIT" } });

    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(4); // exactly one debit
    expect(aiCalls).toBe(1); // the procedure body did NOT re-run
    const debits = await prisma.creditLedger.findMany({
      where: { walletId: w!.id, kind: "DEBIT" },
    });
    expect(debits).toHaveLength(1);
  });

  it("different clientRequestId per call → both charged independently", async () => {
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    await caller.tutor.ask({
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      questionStem: "a",
    });
    await caller.tutor.ask({
      clientRequestId: "55555555-5555-4555-8555-555555555555",
      questionStem: "b",
    });
    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(3);
    expect(aiCalls).toBe(2);
  });
});
