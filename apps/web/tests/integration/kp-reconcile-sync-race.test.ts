import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

async function seedQuestionAndEntry(subjectId: string) {
  const q = await prisma.question.create({
    data: { subjectId, stemMd: "stem", type: "ESSAY", status: "PUBLISHED" },
  });
  const u = await prisma.user.create({ data: { persona: "STUDENT" } });
  const entry = await prisma.errorBookEntry.create({
    data: {
      userId: u.id, questionId: q.id, status: "ACTIVE",
      rootCause: "CONCEPT_CONFUSION", rootCauseReasoning: "test",
    },
  });
  return { questionId: q.id, entryId: entry.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// Plan 9 Task 5 hotfix (review P2): atomic upsert via ON CONFLICT means concurrent
// reconcile of the same (questionId, kpId) from different sources should NOT
// roll back any audit row. Two distinct KpReconcileMatch rows + 1 QuestionKPLink.
describe("reconcileHintsSync — race-safe QuestionKPLink upsert (红线 hotfix P2)", () => {
  it("两个不同 source 并发 reconcile 同 (questionId, kpId) → 两条审计行 + 一条 link，没有 alreadySeen 误计", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const { questionId, entryId } = await seedQuestionAndEntry(subjectId);

    // 并发：source=TUTOR_ADHOC (sourceRefType=QUESTION) + source=ERROR_ANALYSIS
    // (sourceRefType=ERROR_BOOK_ENTRY) 同时把 "一元一次方程" 这个 hint 解析到 kpId
    const [r1, r2] = await Promise.all([
      reconcileHintsSync(prisma, {
        questionId,
        hints: ["一元一次方程"],
        source: "TUTOR_ADHOC",
        sourceRefType: "QUESTION",
        sourceRefId: questionId,
      }),
      reconcileHintsSync(prisma, {
        questionId,
        hints: ["一元一次方程"],
        source: "ERROR_ANALYSIS",
        sourceRefType: "ERROR_BOOK_ENTRY",
        sourceRefId: entryId,
      }),
    ]);

    // 两次调用都 LINKED 一条
    expect(r1.linked).toBe(1);
    expect(r2.linked).toBe(1);
    // 关键：没有任何一次被误算成 alreadySeen（即 QuestionKPLink unique 冲突没污染审计）
    expect(r1.alreadySeen).toBe(0);
    expect(r2.alreadySeen).toBe(0);

    // 审计：两条 KpReconcileMatch（不同 sourceRefType），都 LINKED
    const matches = await prisma.kpReconcileMatch.findMany({
      where: { questionId },
      orderBy: { createdAt: "asc" },
    });
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.status === "LINKED")).toBe(true);
    expect(matches.every((m) => m.kpId === kpId)).toBe(true);
    const sources = matches.map((m) => m.sourceRefType).sort();
    expect(sources).toEqual(["ERROR_BOOK_ENTRY", "QUESTION"]);

    // QuestionKPLink: 单条，weight = 1.0
    const links = await prisma.questionKPLink.findMany({ where: { questionId, kpId } });
    expect(links).toHaveLength(1);
    expect(links[0]!.weight).toBe(1.0);
  });

  it("同 source + 同 sourceRefId + 同 hint 并发两次 → 一条审计 + alreadySeen=1（真幂等）", async () => {
    // 守门：本表 unique 才算 alreadySeen，行为符合原意
    const { subjectId } = await seedSubjectKpAlias();
    const { questionId } = await seedQuestionAndEntry(subjectId);

    const calls = await Promise.all([
      reconcileHintsSync(prisma, {
        questionId, hints: ["一元一次方程"],
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
      }),
      reconcileHintsSync(prisma, {
        questionId, hints: ["一元一次方程"],
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
      }),
    ]);

    // 一边 LINKED 一边 alreadySeen（顺序不定）
    const linkedCount = calls.filter((r) => r.linked === 1).length;
    const seenCount = calls.filter((r) => r.alreadySeen === 1).length;
    expect(linkedCount).toBe(1);
    expect(seenCount).toBe(1);

    // 单条审计 + 单条 link
    expect(await prisma.kpReconcileMatch.count({ where: { questionId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId } })).toBe(1);
  });
});
