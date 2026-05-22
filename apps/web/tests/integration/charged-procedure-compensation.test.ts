import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { ComplianceRejectedError } from "@zhijiao/ai";

// Mode switch so individual tests can choose generic-throw vs
// compliance-rejected behavior. Hoisted mock can't read closures, so
// we keep state on a module-scope variable.
let aiMode: "ok" | "generic-error" | "compliance" = "ok";
vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      if (aiMode === "generic-error") throw new Error("upstream timeout");
      if (aiMode === "compliance") throw new ComplianceRejectedError(["unsafe"]);
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
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-comp",
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
  aiMode = "ok";
});
afterAll(async () => {
  await redis.quit();
});

describe("chargedProcedure compensation policy", () => {
  it("default: generic Error → balance restored + COMPENSATION ledger entry with refId pointing to DEBIT", async () => {
    aiMode = "generic-error";
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.tutor.ask({
        clientRequestId: "66666666-6666-4666-8666-666666666666",
        questionStem: "x",
        studentGrade: "G7",
      }),
    ).rejects.toThrow();

    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(5); // refunded

    const debit = await prisma.creditLedger.findFirst({
      where: { walletId: w!.id, kind: "DEBIT" },
    });
    expect(debit).not.toBeNull();
    const comp = await prisma.creditLedger.findUnique({
      where: { idemKey: `comp:${debit!.id}` },
    });
    expect(comp?.delta).toBe(1);
    expect(comp?.kind).toBe("COMPENSATION");
    expect(comp?.refTable).toBe("credit_ledger");
    expect(comp?.refId).toBe(debit!.id);
    // errorReason() captures the class name visible to the middleware,
    // which is TRPCError (the tutor router catches the upstream Error
    // and re-throws as TRPCError before chargedProcedure sees it).
    const meta = comp?.metadata as { reason?: string };
    expect(meta?.reason).toBe("TRPCError");
  });

  it("whitelist: ComplianceRejectedError → balance NOT restored; debit metadata marks not_compensated_whitelisted", async () => {
    aiMode = "compliance";
    const userId = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.tutor.ask({
        clientRequestId: "77777777-7777-4777-8777-777777777777",
        questionStem: "x",
        studentGrade: "G7",
      }),
    ).rejects.toMatchObject({ cause: { reason: "COMPLIANCE_REJECTED" } });

    const w = await prisma.wallet.findUnique({ where: { userId } });
    expect(w?.balance).toBe(4); // NOT refunded

    const debit = await prisma.creditLedger.findFirst({
      where: { walletId: w!.id, kind: "DEBIT" },
    });
    const meta = debit?.metadata as {
      compensationStatus?: string;
      errorClass?: string;
    };
    expect(meta?.compensationStatus).toBe("not_compensated_whitelisted");
    expect(meta?.errorClass).toBe("ComplianceRejectedError");

    // No COMPENSATION entry exists
    const comps = await prisma.creditLedger.count({
      where: { walletId: w!.id, kind: "COMPENSATION" },
    });
    expect(comps).toBe(0);
  });
});
