import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// Plan 13 Finding C: 容器节点(有子)永不进 EXACT 池，避免粗粒度污染 Plan 11 掌握度。
describe("reconciler leaf-only EXACT guard", () => {
  it("唯一名的容器节点不被 hint EXACT 命中 → UNMATCHED，不写 QuestionKPLink", async () => {
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    // 容器："数与代数"(有子)
    const alg = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg", name: "数与代数", difficulty: 3 },
    });
    // 叶子挂在容器下
    await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg-leaf", name: "一次方程求解", difficulty: 2, parentId: alg.id },
    });
    const q = await prisma.question.create({
      data: { subjectId: math.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["数与代数"], // 文本等于容器名
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000010",
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("UNMATCHED");
    const links = await prisma.questionKPLink.count({ where: { questionId: q.id } });
    expect(links).toBe(0);
  });

  it("叶子名照常 EXACT 命中 → LINKED + 写 QuestionKPLink", async () => {
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const alg = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg", name: "数与代数", difficulty: 3 },
    });
    const leaf = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg-leaf", name: "一次方程求解", difficulty: 2, parentId: alg.id },
    });
    const q = await prisma.question.create({
      data: { subjectId: math.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一次方程求解"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000011",
    });

    expect(r.linked).toBe(1);
    const link = await prisma.questionKPLink.findFirstOrThrow({ where: { questionId: q.id } });
    expect(link.kpId).toBe(leaf.id);  // FK 字段是 kpId（Step 0 确认，非 knowledgePointId）
  });
});
