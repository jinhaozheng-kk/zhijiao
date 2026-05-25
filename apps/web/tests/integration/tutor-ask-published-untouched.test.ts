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

async function seedMathSubject(): Promise<string> {
  const subject = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
  return subject.id;
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask does NOT reuse PUBLISHED rows (spec §6.2 设计代价)", () => {
  it("user input identical to a PUBLISHED stem still creates new USER_ADHOC row", async () => {
    const subjectId = await seedMathSubject();
    // seed 一道 PUBLISHED 题，stem 与用户即将输入的完全相同
    const published = await prisma.question.create({
      data: {
        subjectId,
        stemMd: "解方程 2x + 5 = 13",
        type: "CALCULATION",
        status: "PUBLISHED",
        // 无 createdByUserId / source / normalizedStemHash — PUBLISHED 不在 partial idx 范围
      },
    });

    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.tutor.ask({
      questionStem: "解方程 2x + 5 = 13",
      studentGrade: "G8",
      clientRequestId: crypto.randomUUID(),
    });

    // 关键：新建 USER_ADHOC 行，不复用 PUBLISHED
    expect(r.questionId).not.toBe(published.id);
    const q = await prisma.question.findUniqueOrThrow({ where: { id: r.questionId } });
    expect(q.source).toBe("USER_ADHOC");
    expect(q.createdByUserId).toBe(u.id);

    // PUBLISHED 行 unchanged
    const publishedReread = await prisma.question.findUniqueOrThrow({ where: { id: published.id } });
    expect(publishedReread.status).toBe("PUBLISHED");
    expect(publishedReread.createdByUserId).toBeNull();
  });
});
