import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpsAndAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

async function seedQuestion(subjectId: string): Promise<string> {
  const q = await prisma.question.create({
    data: {
      subjectId,
      stemMd: "x + 1 = 2",
      type: "ESSAY",
      status: "DRAFT",
      source: "USER_ADHOC",
    },
  });
  return q.id;
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("reconcileHintsSync — source=TUTOR_ADHOC / sourceRefType=QUESTION", () => {
  it("EXACT 命中 → LINKED + 写 QuestionKPLink(weight=1.0)", async () => {
    const { subjectId, kpId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["一元一次方程"],
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    expect(r.queued).toBe(0);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.confidence).toBe(1.0);
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId: qid, kpId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("ALIAS 命中 → LINKED + 写 QuestionKPLink", async () => {
    const { subjectId, kpId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["Linear Eq"], // 大小写不同，normalize 后命中 alias "linear eq"
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.matchVia).toBe("ALIAS");
    expect(match.kpId).toBe(kpId);
  });

  it("未命中 → UNMATCHED + 不写 QuestionKPLink", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["未知概念"],
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.queued).toBe(1);
    expect(r.linked).toBe(0);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.status).toBe("UNMATCHED");
    expect(match.kpId).toBeNull();
    expect(match.matchVia).toBeNull();
    const linkCount = await prisma.questionKPLink.count({ where: { questionId: qid } });
    expect(linkCount).toBe(0);
  });

  it("重复同 hint → alreadySeen 计数，DB 行数不变", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    await reconcileHintsSync(prisma, {
      questionId: qid, hints: ["一元一次方程"], source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });
    const r2 = await reconcileHintsSync(prisma, {
      questionId: qid, hints: ["一元一次方程"], source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });

    expect(r2.alreadySeen).toBe(1);
    const count = await prisma.kpReconcileMatch.count({ where: { questionId: qid } });
    expect(count).toBe(1);
  });

  it("一批内同一 normalize hint 只处理一次", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["一元一次方程", "  一元一次方程  ", "一元一次方程"],
      source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    expect(r.alreadySeen).toBe(0); // 同批内 dedup，不算 alreadySeen
    const count = await prisma.kpReconcileMatch.count({ where: { questionId: qid } });
    expect(count).toBe(1);
  });
});
