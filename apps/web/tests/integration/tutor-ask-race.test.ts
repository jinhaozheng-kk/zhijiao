import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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

describe("tutor.ask race", () => {
  it("two concurrent asks for same user+stem → both succeed, 1 Question row, same questionId (P2002 fall-through 重读赢家)", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    const [r1, r2] = await Promise.all([
      caller.tutor.ask({ questionStem: "race test stem", studentGrade: "G8", clientRequestId: crypto.randomUUID() }),
      caller.tutor.ask({ questionStem: "race test stem", studentGrade: "G8", clientRequestId: crypto.randomUUID() }),
    ]);

    expect(r1.questionId).toBe(r2.questionId);
    expect(await prisma.question.count({ where: { createdByUserId: u.id, source: "USER_ADHOC" } })).toBe(1);
  });
});
