// Mirrors paper-generate.test.ts's mock + fixtures pattern (getAiRouter is vi.mock'd).
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx } from "./_helpers/error-book-fixtures";

const { generatePaperMock } = vi.hoisted(() => ({ generatePaperMock: vi.fn() }));
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ generatePaper: generatePaperMock }) }));
const { appRouter } = await import("@/server/routers/_root");

// mock builds items per requested sections; difficulty/points/cognitive are "non-template" values
// to prove they get overridden by slot metadata at persist.
function mockGenerate(input: { sections?: Array<{ type: string; count: number }> }) {
  const items: any[] = [];
  let n = 0;
  for (const s of input.sections ?? []) {
    for (let i = 0; i < s.count; i++) {
      items.push({
        stemMd: `${String.fromCharCode(97 + (n % 26))} ${s.type} 原创题 ${++n}`,
        type: s.type,
        options: s.type === "SINGLE_CHOICE" ? ["甲", "乙", "丙", "丁"] : undefined,
        answerMd: "答", solutionMd: "分步解析。",
        difficulty: 2, cognitiveLevel: "APPLY", points: 5,
        knowledgePointHints: ["一次函数"],
      });
    }
  }
  return { title: "卷", modelCallId: "mc1", items };
}

async function seedTeacher(balance: number) {
  const u = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.wallet.create({ data: { userId: u.id, balance } });
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  const kp = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: subject.id, code: "math-g8-linear-eq-solve" } },
    create: { subjectId: subject.id, code: "math-g8-linear-eq-solve", name: "一次方程求解" },
    update: {},
  });
  return { id: u.id, subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => {
  await resetDb();
  generatePaperMock.mockReset();
  generatePaperMock.mockImplementation(mockGenerate);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("paper.generate 中考风格模板", () => {
  it("styleTemplate 模式：落库 24 题 + paramsJson 含 blueprint + styleTemplate", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: true } });
    expect(paper.items).toHaveLength(24);
    const params = paper.paramsJson as any;
    expect(params.styleTemplate).toBe("JUNIOR_MATH_ZHONGKAO_GENERIC_V1");
    expect(params.blueprint.slots).toHaveLength(24);
  });

  it("落库分值/难度/能力以 slot 为准（覆盖 mock 的 5 分/难度 2/APPLY），总分 120", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });
    const items = await prisma.paperItem.findMany({ where: { paperId }, orderBy: { position: "asc" } });
    const firstChoice = items.find((i) => i.type === "SINGLE_CHOICE")!;
    expect(firstChoice.points).toBe(3);
    expect(firstChoice.difficulty).toBe(1);
    expect(items.reduce((n, i) => n + i.points, 0)).toBe(120);
  });

  it("BLOCKER（mock 返回空答案题）→ BAD_REQUEST + 退款（余额回 100）", async () => {
    const t = await seedTeacher(100);
    generatePaperMock.mockImplementation((input: any) => {
      const out = mockGenerate(input);
      if (out.items[0]) out.items[0].answerMd = "   "; // 空答案 → EMPTY_ANSWER BLOCKER
      return out;
    });
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    await expect(
      caller.paper.generate({
        subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
        styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
        clientRequestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: t.id } });
    expect(wallet.balance).toBe(100);
  });

  it("手动 sections 模式仍可用（向后兼容）", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8",
      sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }],
      difficultyRange: [1, 3], textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    });
    const items = await prisma.paperItem.findMany({ where: { paperId } });
    expect(items).toHaveLength(1);
  });
});
