import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
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
      userId: u.id,
      questionId: q.id,
      status: "ACTIVE",
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "test",
    },
  });
  return { questionId: q.id, entryId: entry.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync — source=ERROR_ANALYSIS / sourceRefType=ERROR_BOOK_ENTRY", () => {
  it("EXACT 命中 → LINKED + 写 QuestionKPLink；sourceRefId 是 entryId 非 ledgerId", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const { questionId, entryId } = await seedQuestionAndEntry(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["一元一次方程"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: entryId,
    });

    expect(r.linked).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });
    expect(match.sourceRefType).toBe("ERROR_BOOK_ENTRY");
    expect(match.sourceRefId).toBe(entryId);   // 关键：不是 diagnoseLedgerId
    expect(match.status).toBe("LINKED");
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId } },
    });
    expect(link.weight).toBe(1.0);
  });
});
