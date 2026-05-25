import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      return { restatement: "x", knowledgePoints: [], steps: ["s"], pitfalls: [], finalAnswer: "a" };
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

describe("tutor.ask stem > 4000 chars", () => {
  // 锁 spec §3.2 设计：超长走 zod 兜底（不是 INPUT_COMPLIANCE_REJECTED）。
  // chargeMiddleware 在 zod .input() 前跑，所以超长输入会产生 DEBIT + COMPENSATION
  // 配对，净余额不变。与违禁词路径（不扣费、ledger 无 DEBIT row）不同。
  it("zod rejects with BAD_REQUEST (NOT INPUT_COMPLIANCE_REJECTED); DEBIT+COMPENSATION allowed; net balance unchanged", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    const longStem = "x".repeat(5000);   // 超过 zod max(4000)
    let err: unknown;
    try {
      await caller.tutor.ask({
        questionStem: longStem,
        studentGrade: "G8",
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("BAD_REQUEST");
    // 关键：NOT INPUT_COMPLIANCE_REJECTED — 锁 spec §3.2 边界
    expect((trpc.cause as { reason?: string } | undefined)?.reason).not.toBe("INPUT_COMPLIANCE_REJECTED");

    // 允许 DEBIT + COMPENSATION 配对（spec §3.2 副作用）
    const debit = await prisma.creditLedger.findFirst({
      where: { walletId: u.walletId, kind: "DEBIT", actionKind: "TUTOR_ASK" },
    });
    if (debit) {
      // 如有 DEBIT，应有 COMPENSATION 配对
      const comp = await prisma.creditLedger.findFirst({
        where: { walletId: u.walletId, kind: "COMPENSATION", refId: debit.id },
      });
      expect(comp).not.toBeNull();
    }

    // 净余额不变
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(100);
  });
});
