import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { seedCurriculum, seedKpAliases } from "@zhijiao/db/seed";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

// 验证 reconciler 能把题面 hint 命中到 Plan 13 新增的全学段 KP。
// 用真 seed 树（seedCurriculum + seedKpAliases），不手搭 fixture —— 证明实际落库的
// KP 名 / 别名能被 EXACT / ALIAS 命中，且容器节点被 leaf-only 守卫挡在外面。
beforeAll(async () => {
  await resetDb();
  await seedCurriculum(prisma); // 185 KP 全学段树
  await seedKpAliases(prisma); // 叶子内联 aliases
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function mathQuestion(): Promise<string> {
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });
  const q = await prisma.question.create({
    data: { subjectId: math.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  return q.id;
}

let refSeq = 0;
async function reconcile(questionId: string, hints: string[]) {
  refSeq += 1;
  return reconcileHintsSync(prisma, {
    questionId,
    hints,
    source: "ERROR_ANALYSIS",
    sourceRefType: "ERROR_BOOK_ENTRY",
    sourceRefId: `clrefnewkp${String(refSeq).padStart(13, "0")}`,
  });
}

async function linkedCodes(questionId: string): Promise<string[]> {
  const links = await prisma.questionKPLink.findMany({
    where: { questionId },
    include: { kp: true },
  });
  return links.map((l) => l.kp.code).sort();
}

describe("reconciler 命中 Plan 13 新 KP（EXACT by name，跨三学段）", () => {
  it("初中/高中/小学 叶子名各自 EXACT 命中到正确 KP", async () => {
    const q = await mathQuestion();
    const r = await reconcile(q, [
      "勾股定理", // 初中 math-jh-geo-tri-pythagorean
      "因式分解", // 初中 math-jh-alg-poly-factor
      "导数的应用", // 高中 math-sh-fn-derivative-apply
      "比和比例", // 小学 math-pri-num-relation-ratio
    ]);
    expect(r.linked).toBe(4);
    expect(await linkedCodes(q)).toEqual(
      [
        "math-jh-alg-poly-factor",
        "math-jh-geo-tri-pythagorean",
        "math-pri-num-relation-ratio",
        "math-sh-fn-derivative-apply",
      ].sort(),
    );
  });
});

describe("reconciler 命中 Plan 13 新 KP（ALIAS）", () => {
  it("别名 hint 命中到挂别名的叶子", async () => {
    const q = await mathQuestion();
    const r = await reconcile(q, [
      "韦达定理", // alias → 初中 math-jh-alg-quad-eq-discriminant
      "均值不等式", // alias → 高中 math-sh-prep-inequality-mean
      "万以内数", // alias → 小学 math-pri-num-cognition-integer
    ]);
    expect(r.linked).toBe(3);
    expect(await linkedCodes(q)).toEqual(
      [
        "math-jh-alg-quad-eq-discriminant",
        "math-pri-num-cognition-integer",
        "math-sh-prep-inequality-mean",
      ].sort(),
    );
  });
});

describe("leaf-only 守卫 + 未匹配（Plan 13 Finding C / 现实保守行为）", () => {
  it("领域/主题等容器名不被命中，落 UNMATCHED，不写 QuestionKPLink", async () => {
    const q = await mathQuestion();
    const r = await reconcile(q, [
      "图形与几何", // L2 容器（初中领域）—— 不该命中
      "数与代数", // L2 容器
      "三角形", // L3 容器（初中主题）—— 不该命中
    ]);
    expect(r.linked).toBe(0);
    expect(r.queued).toBe(3);
    expect(await linkedCodes(q)).toEqual([]);
  });

  it("树里不存在的 hint 落 UNMATCHED", async () => {
    const q = await mathQuestion();
    const r = await reconcile(q, ["量子纠缠"]);
    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
  });
});

describe("跨学段同名：单 subject 下确定性命中（已知设计取舍）", () => {
  it("'二次函数' 经 alias 命中初中叶子（高中同名为容器，被 leaf-only 排除）", async () => {
    const q = await mathQuestion();
    const r = await reconcile(q, ["二次函数"]);
    expect(r.linked).toBe(1);
    expect(await linkedCodes(q)).toEqual(["math-jh-alg-quad-fn-prop"]);
  });
});
