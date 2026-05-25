import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(_input: unknown) {
      return {
        restatement: "求 2x+5=13。",
        knowledgePoints: ["一元一次方程"],
        steps: ["移项 2x=8", "两边除 2 得 x=4"],
        pitfalls: [],
        finalAnswer: "4",
      };
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

describe("tutor.ask returns questionId + writes USER_ADHOC Question", () => {
  it("happy path", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.tutor.ask({
      questionStem: "解方程 2x + 5 = 13",
      studentGrade: "G8",
      clientRequestId: crypto.randomUUID(),
    });

    expect(r.questionId).toMatch(/^c[a-z0-9]+$/);
    expect(r.restatement).toBeDefined();

    const q = await prisma.question.findUniqueOrThrow({ where: { id: r.questionId } });
    expect(q.source).toBe("USER_ADHOC");
    expect(q.createdByUserId).toBe(u.id);
    expect(q.status).toBe("DRAFT");
    expect(q.type).toBe("ESSAY");
    expect(q.normalizedStemHash).not.toBeNull();
  });
});
