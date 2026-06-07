import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { selectBankQuestions, persistGeneratedPaper } from "@/server/lib/paper-generation";

async function mathId() { const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} }); return s.id; }
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("paper-generation", () => {
  it("selectBankQuestions 题库空返回空（不报错）", async () => {
    const subjectId = await mathId();
    const r = await selectBankQuestions(prisma, { subjectId, kpIds: ["nonexistent-kp"], questionTypes: ["CALCULATION"], difficultyRange: [1,3], limit: 5 });
    expect(r).toEqual([]);
  });

  it("persistGeneratedPaper 落 Paper + PaperItem + AI Question(PAPER_GENERATED)", async () => {
    const subjectId = await mathId();
    const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });
    const paper = await persistGeneratedPaper(prisma, {
      teacherUserId: teacher.id, subjectId, debitLedgerId: null, modelCallId: "mc1",
      paramsJson: { count: 1 }, title: "卷",
      bankItems: [],
      aiItems: [{ stemMd: "题1", type: "CALCULATION", answerMd: "1", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] }],
    });
    const items = await prisma.paperItem.findMany({ where: { paperId: paper.id }, orderBy: { position: "asc" } });
    expect(items.length).toBe(1);
    const item0 = items[0]!;
    expect(item0.source).toBe("AI_GENERATED");
    const q = await prisma.question.findUniqueOrThrow({ where: { id: item0.questionId! } });
    expect(q.source).toBe("PAPER_GENERATED");
    expect(q.createdByUserId).toBe(teacher.id);
  });

  it("persistGeneratedPaper drops duplicate AI stems within one paper", async () => {
    const subjectId = await mathId();
    const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });

    const paper = await persistGeneratedPaper(prisma, {
      teacherUserId: teacher.id, subjectId, debitLedgerId: null, modelCallId: "mc1",
      paramsJson: { count: 2 }, title: "dedup",
      bankItems: [],
      aiItems: [
        { stemMd: "Solve 2x + 1 = 5.", type: "CALCULATION", answerMd: "x=2", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["linear equations"] },
        { stemMd: "  Solve   2x + 1 = 5.  ", type: "CALCULATION", answerMd: "x=2", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["linear equations"] },
      ],
    });

    const items = await prisma.paperItem.findMany({ where: { paperId: paper.id }, orderBy: { position: "asc" } });
    expect(items).toHaveLength(1);
    expect(items[0]!.position).toBe(1);
  });

  it("persistGeneratedPaper prefers bank item over AI item with the same numeric template", async () => {
    const subjectId = await mathId();
    const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });
    const bankQuestion = await prisma.question.create({
      data: {
        subjectId,
        stemMd: "求 y=2x+1 当 x=2 的值",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
      },
    });

    const paper = await persistGeneratedPaper(prisma, {
      teacherUserId: teacher.id, subjectId, debitLedgerId: null, modelCallId: "mc1",
      paramsJson: { count: 2 }, title: "dedup",
      bankItems: [{
        questionId: bankQuestion.id,
        stemMd: "求 y=2x+1 当 x=2 的值",
        type: "CALCULATION",
        optionsJson: null,
        answerMd: "5",
        solutionMd: "substitute",
        rubricMd: null,
        difficulty: 2,
        cognitiveLevel: "APPLY",
        kpHints: ["linear functions"],
        points: 5,
      }],
      aiItems: [
        { stemMd: "求 y=2x+1 当 x=3 的值", type: "CALCULATION", answerMd: "7", solutionMd: "substitute", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["linear functions"] },
      ],
    });

    const items = await prisma.paperItem.findMany({ where: { paperId: paper.id }, orderBy: { position: "asc" } });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("BANK");
    expect(items[0]!.questionId).toBe(bankQuestion.id);
  });
});
