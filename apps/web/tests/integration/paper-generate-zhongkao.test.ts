// Mirrors paper-generate.test.ts's mock + fixtures pattern (getAiRouter is vi.mock'd).
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx } from "./_helpers/error-book-fixtures";

const { generatePaperMock } = vi.hoisted(() => ({ generatePaperMock: vi.fn() }));
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ generatePaper: generatePaperMock }) }));
const { appRouter } = await import("@/server/routers/_root");

// mock builds items per requested sections; difficulty/points/cognitive are "non-template" values
// to prove they get overridden by slot metadata at persist.
// 注：解答题解析必须 ≥80 字，否则会触发内容质量门 BLOCKER（SHORT_SOLUTION）。
const LONG_ESSAY_SOLUTION =
  "设未知数为 x，根据题意列出关系式，化简后求解得到 x 的值，再代回原题检验并写出结论。" +
  "（第一步设元，第二步列式，第三步解方程，第四步检验作答，各步均写出必要过程。）";
function mockGenerate(input: { sections?: Array<{ type: string; count: number }> }, prefix = "") {
  const items: any[] = [];
  let n = 0;
  for (const s of input.sections ?? []) {
    for (let i = 0; i < s.count; i++) {
      items.push({
        stemMd: `${prefix}${String.fromCharCode(97 + (n % 26))} ${s.type} 原创题 ${++n}`,
        type: s.type,
        options: s.type === "SINGLE_CHOICE" ? ["甲", "乙", "丙", "丁"] : undefined,
        answerMd: "答",
        solutionMd: s.type === "ESSAY" ? LONG_ESSAY_SOLUTION : "把已知条件代入公式，逐步计算可得结果。",
        rubricMd: s.type === "ESSAY" ? "设未知数 2 分；列式 3 分；求解 3 分；检验作答 2 分。" : undefined,
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
    expect(paper.status).toBe("READY");
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

  it("首轮只有局部题目不合格时只替换坏题，并保留其他合格题", async () => {
    const t = await seedTeacher(100);
    generatePaperMock
      .mockImplementationOnce((input: any) => {
        const out = mockGenerate(input, "bad-");
        if (out.items[0]) out.items[0].answerMd = "   ";
        return out;
      })
      .mockImplementationOnce((input: any) => mockGenerate(input, "ok-"))
      .mockImplementationOnce((input: any) => mockGenerate(input, "ok-"))
      .mockImplementationOnce((input: any) => mockGenerate(input, "repair-"));

    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });

    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { orderBy: { position: "asc" } } } });
    expect(paper.status).toBe("READY");
    expect(paper.items).toHaveLength(24);
    expect(paper.items[0]!.stemMd).toContain("repair-");
    expect(paper.items[1]!.stemMd).toContain("bad-");
    expect(paper.paramsJson).toMatchObject({ reviewBlockers: [] });
    expect(generatePaperMock).toHaveBeenCalledTimes(4);
    expect(generatePaperMock.mock.calls[3]![0].sections).toEqual([
      { type: "SINGLE_CHOICE", count: 1 },
    ]);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: t.id } })).balance).toBe(95);
  });

  it("局部补救时优先使用题库备用候选，避免额外 AI 调用", async () => {
    const t = await seedTeacher(100);
    const stems = [
      "bank fill blank alpha",
      "bank fill blank beta",
      "bank fill blank gamma",
      "bank fill blank delta",
      "bank fill blank epsilon",
      "bank fill blank zeta",
      "spare fill blank stem",
    ];
    for (let i = 0; i < 7; i++) {
      await prisma.question.create({
        data: {
          subjectId: t.subjectId,
          stemMd: stems[i]!,
          type: "FILL_BLANK",
          difficulty: 2,
          status: "PUBLISHED",
          cognitiveLevel: "APPLY",
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          answer: { create: { contentMd: i === 0 ? "   " : "1", solutionMd: "solution" } },
          knowledgePoints: { create: { kpId: t.kpId, weight: 1 } },
        },
      });
    }
    generatePaperMock.mockImplementation((input: any) => mockGenerate(input, "ai-"));

    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });

    const items = await prisma.paperItem.findMany({ where: { paperId }, orderBy: { position: "asc" } });
    expect(items[10]!.stemMd).toBe("spare fill blank stem");
    expect(generatePaperMock).toHaveBeenCalledTimes(2);
    expect(generatePaperMock.mock.calls.map((call) => call[0].sections)).toEqual([
      [{ type: "SINGLE_CHOICE", count: 10 }],
      [{ type: "ESSAY", count: 8 }],
    ]);
  });

  it("填空题误带选项时自动清理，不触发额外 AI 补救", async () => {
    const t = await seedTeacher(100);
    generatePaperMock.mockImplementation((input: any) => {
      const out = mockGenerate(input);
      for (const item of out.items) {
        if (item.type === "FILL_BLANK") item.options = ["误选项 A", "误选项 B"];
      }
      return out;
    });

    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });

    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { orderBy: { position: "asc" } } } });
    expect(paper.status).toBe("READY");
    expect(paper.paramsJson).toMatchObject({ reviewBlockers: [] });
    expect(paper.items.filter((item) => item.type === "FILL_BLANK").every((item) => item.optionsJson == null)).toBe(true);
    expect(generatePaperMock).toHaveBeenCalledTimes(3);
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
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: expect.objectContaining({ reason: "PAPER_REVIEW_BLOCKED" }),
    });
    expect(await prisma.paper.count({ where: { teacherUserId: t.id } })).toBe(0);
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
