import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  async generatePaper(input: { sections?: Array<{ type: string; count: number }> }) {
    // Echo per-type items so per-type assertions in tests hold.
    if (input.sections && input.sections.length > 0) {
      const items: Array<{
        stemMd: string; type: string; answerMd: string; solutionMd: string;
        difficulty: number; cognitiveLevel: string; points: number; knowledgePointHints: string[];
      }> = [];
      let n = 0;
      for (const s of input.sections) {
        for (let i = 0; i < s.count; i++) {
          items.push({
            stemMd: `题${++n}`,
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
    // Fallback: single CALCULATION item for backward compatibility.
    return { title: "卷", modelCallId: "mc1", items: [
      { stemMd: "题1", type: "CALCULATION", answerMd: "1", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
    ] };
  },
}) }));
const { appRouter } = await import("@/server/routers/_root");

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

beforeEach(async () => { await resetDb(); });
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
});
