import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "../src/test-utils.js";
import { seedCurriculum } from "../prisma/seed/0_curriculum.js";
import { seedKpAliases } from "../prisma/seed/3_kp_aliases.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await testPrisma.$disconnect(); });

describe("KP tree seed", () => {
  it("连跑两次幂等：KP 行数不变、无重复", async () => {
    await seedCurriculum(testPrisma);
    const after1 = await testPrisma.knowledgePoint.count();
    await seedCurriculum(testPrisma);
    const after2 = await testPrisma.knowledgePoint.count();
    expect(after2).toBe(after1);
    expect(after1).toBeGreaterThan(4); // 全学段 > 旧的 4
  });

  it("现有 4 KP code 保留且被 re-parent 到新树", async () => {
    await seedCurriculum(testPrisma);
    const math = await testPrisma.subject.findUniqueOrThrow({ where: { code: "math" } });

    const solve = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
    });
    const linearEq = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq" } },
    });
    // 一次方程求解 的父是 一次方程
    expect(solve.parentId).toBe(linearEq.id);
    // 一次方程 的父是 数与代数(L2)，再上是 初中(L1)
    const alg = await testPrisma.knowledgePoint.findUniqueOrThrow({ where: { id: linearEq.parentId! } });
    expect(alg.code).toBe("math-jh-alg");
    const jh = await testPrisma.knowledgePoint.findUniqueOrThrow({ where: { id: alg.parentId! } });
    expect(jh.code).toBe("math-jh");
    expect(jh.parentId).toBeNull();
  });

  it("alias seed 幂等且内联 alias 落库", async () => {
    await seedCurriculum(testPrisma);
    await seedKpAliases(testPrisma);
    await seedKpAliases(testPrisma); // 第二次幂等
    const math = await testPrisma.subject.findUniqueOrThrow({ where: { code: "math" } });
    const alias = await testPrisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId: math.id, normalizedAlias: "一元一次方程" } },
    });
    const solve = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
    });
    expect(alias.kpId).toBe(solve.id);
  });
});
