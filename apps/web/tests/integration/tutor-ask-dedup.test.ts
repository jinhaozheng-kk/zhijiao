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

describe("tutor.ask dedup", () => {
  it("same user + same stem returns same questionId; Question table 1 row", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r1 = await caller.tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await caller.tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).toBe(r1.questionId);
    expect(await prisma.question.count({ where: { createdByUserId: u.id } })).toBe(1);
  });

  it("different users with same stem each get their own questionId", async () => {
    const u1 = await seedUserWithBalance(100);
    const u2 = await seedUserWithBalance(100);
    const r1 = await appRouter.createCaller(makeCtx(u1.id)).tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await appRouter.createCaller(makeCtx(u2.id)).tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).not.toBe(r1.questionId);
  });

  it("whitespace-only differences in stem still dedupe", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r1 = await caller.tutor.ask({ questionStem: "  2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await caller.tutor.ask({ questionStem: "2x   +   5   =   13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).toBe(r1.questionId);
  });
});
