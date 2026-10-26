import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

const { generatePaperMock } = vi.hoisted(() => ({
  generatePaperMock: vi.fn(),
}));

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  generatePaper: generatePaperMock,
}) }));
const { appRouter } = await import("@/server/routers/_root");

function defaultGeneratePaper(input: { sections?: Array<{ type: string; count: number }> }) {
  if (input.sections && input.sections.length > 0) {
    const items: Array<{
      stemMd: string; type: string; answerMd: string; solutionMd: string;
      difficulty: number; cognitiveLevel: string; points: number; knowledgePointHints: string[];
    }> = [];
    let n = 0;
    for (const s of input.sections) {
      for (let i = 0; i < s.count; i++) {
        const marker = String.fromCharCode(97 + (n % 26));
        items.push({
          stemMd: `${marker} ${s.type} generated stem ${++n}`,
          type: s.type,
          answerMd: "答",
          solutionMd: "解",
          difficulty: 2,
          cognitiveLevel: "APPLY",
          points: 5,
          knowledgePointHints: ["一次函数"],
        });
      }
    }
    return { title: "卷", modelCallId: "mc1", items };
  }
  return { title: "卷", modelCallId: "mc1", items: [
    { stemMd: "题1", type: "CALCULATION", answerMd: "1", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
  ] };
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
  generatePaperMock.mockImplementation(defaultGeneratePaper);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("paper.generate", () => {
  it("教师全 AI 出卷：落 Paper + Question(PAPER_GENERATED)、扣 5", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }], difficultyRange: [1,3], textbookVersion: "GENERIC", clientRequestId: crypto.randomUUID() });
    expect(r.paperId).toBeTruthy();
    expect(await prisma.paperItem.count({ where: { paperId: r.paperId } })).toBe(1);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(95);
  });

  it("非教师调用：扣费前 FORBIDDEN、不写 DEBIT", async () => {
    const t = await seedTeacher(100);
    const student = await seedUserWithBalance(100); // persona STUDENT
    const caller = appRouter.createCaller(makeCtx(student.id));
    await expect(caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }], difficultyRange: [1,3], textbookVersion: "GENERIC", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.creditLedger.count({ where: { wallet: { userId: student.id }, kind: "DEBIT" } })).toBe(0);
  });

  it("kpIds 不属于 subject：写 DEBIT 后补偿（净零）、不落 Paper", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    await expect(caller.paper.generate({ subjectId: t.subjectId, kpIds: ["clxnonexistentkp00000000"], gradeLevel: "G8", sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }], difficultyRange: [1,3], textbookVersion: "GENERIC", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.paper.count({ where: { teacherUserId: t.id } })).toBe(0);
    expect((await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } })).balance).toBe(100);
  });

  it("markReady DRAFT→READY；跨教师 NOT_FOUND", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }], difficultyRange: [1,3], textbookVersion: "GENERIC", clientRequestId: crypto.randomUUID() });
    await caller.paper.markReady({ paperId: r.paperId });
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: r.paperId } })).status).toBe("READY");
    const other = await seedTeacher(100);
    await expect(appRouter.createCaller(makeCtx(other.id, { persona: "TEACHER" })).paper.markReady({ paperId: r.paperId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("按题型设定题数与分值落库，paramsJson 含时长/教材版本", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const res = await caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [t.kpId],
      gradeLevel: "G8",
      sections: [
        { type: "SINGLE_CHOICE", count: 3, pointsPerItem: 3 },
        { type: "CALCULATION", count: 2, pointsPerItem: 8 },
      ],
      difficultyRange: [2, 4],
      durationMinutes: 120,
      textbookVersion: "RENJIAO",
      clientRequestId: crypto.randomUUID(),
    });

    const paper = await prisma.paper.findUniqueOrThrow({
      where: { id: res.paperId },
      include: { items: true },
    });
    const single = paper.items.filter((i) => i.type === "SINGLE_CHOICE");
    const calc = paper.items.filter((i) => i.type === "CALCULATION");
    expect(single).toHaveLength(3);
    expect(calc).toHaveLength(2);
    expect(single.every((i) => i.points === 3)).toBe(true);
    expect(calc.every((i) => i.points === 8)).toBe(true);

    const params = paper.paramsJson as { durationMinutes?: number; textbookVersion?: string };
    expect(params.durationMinutes).toBe(120);
    expect(params.textbookVersion).toBe("RENJIAO");
  });

  it("passes the selected knowledge point names into paper generation", async () => {
    const t = await seedTeacher(100);
    const selectedKp = await prisma.knowledgePoint.create({
      data: {
        subjectId: t.subjectId,
        code: `factorization-${crypto.randomUUID()}`,
        name: "factorization",
      },
    });
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));

    await caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [selectedKp.id],
      gradeLevel: "G8",
      sections: [{ type: "CALCULATION", count: 1, pointsPerItem: 5 }],
      difficultyRange: [1, 3],
      textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    });

    expect(generatePaperMock).toHaveBeenCalledWith(
      expect.objectContaining({ kpNames: ["factorization"] }),
    );
  });

  it("overfetches bank candidates so local dedup can avoid unnecessary AI calls", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    for (const stemMd of [
      "Duplicate calculation stem",
      "Duplicate calculation stem",
      "Unique calculation stem",
    ]) {
      await prisma.question.create({
        data: {
          subjectId: t.subjectId,
          stemMd,
          type: "CALCULATION",
          difficulty: 2,
          status: "PUBLISHED",
          cognitiveLevel: "APPLY",
          answer: { create: { contentMd: "1", solutionMd: "solution" } },
          knowledgePoints: { create: { kpId: t.kpId, weight: 1 } },
        },
      });
    }

    const res = await caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [t.kpId],
      gradeLevel: "G8",
      sections: [{ type: "CALCULATION", count: 2, pointsPerItem: 5 }],
      difficultyRange: [1, 3],
      textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    });

    const items = await prisma.paperItem.findMany({ where: { paperId: res.paperId }, orderBy: { position: "asc" } });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.source === "BANK")).toBe(true);
    expect(generatePaperMock).not.toHaveBeenCalled();
  });

  it("splits multi-section AI generation into per-type calls", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));

    await caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [t.kpId],
      gradeLevel: "G8",
      sections: [
        { type: "SINGLE_CHOICE", count: 1, pointsPerItem: 3 },
        { type: "CALCULATION", count: 1, pointsPerItem: 5 },
      ],
      difficultyRange: [1, 3],
      textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    });

    expect(generatePaperMock).toHaveBeenCalledTimes(2);
    expect(generatePaperMock.mock.calls.map((call) => call[0].sections)).toEqual([
      [{ type: "SINGLE_CHOICE", count: 1 }],
      [{ type: "CALCULATION", count: 1 }],
    ]);
  });

  it("AI 首轮生成重复题时自动补题直到题量满足", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    generatePaperMock
      .mockResolvedValueOnce({
        title: "卷",
        modelCallId: "mc-first",
        items: [
          { stemMd: "求 y=2x+1 当 x=2 的值", type: "CALCULATION", answerMd: "5", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
          { stemMd: "求 y=2x+1 当 x=3 的值", type: "CALCULATION", answerMd: "7", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
        ],
      })
      .mockResolvedValueOnce({
        title: "卷",
        modelCallId: "mc-refill",
        items: [
          { stemMd: "已知直线 y=kx+3 经过点 (2,7)，求 k", type: "CALCULATION", answerMd: "2", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
        ],
      });

    const res = await caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [t.kpId],
      gradeLevel: "G8",
      sections: [{ type: "CALCULATION", count: 2, pointsPerItem: 5 }],
      difficultyRange: [1, 3],
      textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    });

    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: res.paperId }, include: { items: { orderBy: { position: "asc" } } } });
    expect(paper.items).toHaveLength(2);
    expect(paper.items.map((item) => item.stemMd)).toEqual([
      "求 y=2x+1 当 x=2 的值",
      "已知直线 y=kx+3 经过点 (2,7)，求 k",
    ]);
    expect(generatePaperMock).toHaveBeenCalledTimes(2);
    expect(generatePaperMock.mock.calls[1]![0]).toMatchObject({
      sections: [{ type: "CALCULATION", count: 2 }],
    });
    expect(generatePaperMock.mock.calls[1]![0].excludeStems).toEqual(
      expect.arrayContaining(["求 y=2x+1 当 x=2 的值", "求 y=2x+1 当 x=3 的值"]),
    );
    expect(paper.paramsJson).toMatchObject({
      dedupDroppedCount: 1,
      refillRounds: 1,
      modelCallIds: ["mc-first", "mc-refill"],
    });
  });

  it("自动补题后仍不足时不落残缺试卷并补偿扣费", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    generatePaperMock.mockResolvedValue({
      title: "卷",
      modelCallId: "mc-dup",
      items: [
        { stemMd: "求 y=2x+1 当 x=2 的值", type: "CALCULATION", answerMd: "5", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
      ],
    });

    await expect(caller.paper.generate({
      subjectId: t.subjectId,
      kpIds: [t.kpId],
      gradeLevel: "G8",
      sections: [{ type: "CALCULATION", count: 2, pointsPerItem: 5 }],
      difficultyRange: [1, 3],
      textbookVersion: "GENERIC",
      clientRequestId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(generatePaperMock).toHaveBeenCalledTimes(3);
    expect(await prisma.paper.count({ where: { teacherUserId: t.id } })).toBe(0);
    expect((await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } })).balance).toBe(100);
    expect(await prisma.creditLedger.count({ where: { wallet: { userId: t.id }, kind: "COMPENSATION" } })).toBe(1);
  });
});
