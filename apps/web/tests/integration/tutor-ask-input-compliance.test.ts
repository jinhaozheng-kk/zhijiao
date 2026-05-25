import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      // Should never be called — violation aborts in compliance middleware before AI.
      throw new Error("AI must not be called when INPUT_COMPLIANCE_REJECTED");
    },
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

async function seedMathSubject() {
  await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
}

beforeEach(async () => {
  await resetDb();
  await seedMathSubject();
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask INPUT_COMPLIANCE_REJECTED path", () => {
  it("forbidden phrase in stem → BAD_REQUEST + no charge + no Question row", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    let err: unknown;
    try {
      await caller.tutor.ask({
        questionStem: "解方程 押中原题 2x + 5 = 13",
        studentGrade: "G8",
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("BAD_REQUEST");
    expect((trpc.cause as { reason?: string } | undefined)?.reason).toBe("INPUT_COMPLIANCE_REJECTED");

    // 不扣费
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(100);

    // CreditLedger 无 DEBIT row (排除 bootstrap topup)
    const debits = await prisma.creditLedger.count({
      where: { walletId: u.walletId, kind: "DEBIT", actionKind: "TUTOR_ASK" },
    });
    expect(debits).toBe(0);

    // Question 表无新行
    expect(await prisma.question.count({ where: { createdByUserId: u.id } })).toBe(0);
  });
});
