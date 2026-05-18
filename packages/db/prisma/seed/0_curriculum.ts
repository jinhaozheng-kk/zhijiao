import { PrismaClient } from "@prisma/client";

export async function seedCurriculum(prisma: PrismaClient) {
  // 1 学科：初中数学（math）
  const math = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });

  // 知识点树（极简：1 个一级 + 3 个二级）
  const linearEq = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq" } },
    create: {
      subjectId: math.id,
      code: "math-g8-linear-eq",
      name: "一次方程",
      difficulty: 2,
    },
    update: {},
  });

  for (const child of [
    { code: "math-g8-linear-eq-solve", name: "一次方程求解", difficulty: 2 },
    { code: "math-g8-linear-eq-apply", name: "一次方程应用题", difficulty: 3 },
    { code: "math-g8-linear-eq-system", name: "二元一次方程组", difficulty: 3 },
  ]) {
    await prisma.knowledgePoint.upsert({
      where: { subjectId_code: { subjectId: math.id, code: child.code } },
      create: {
        subjectId: math.id,
        code: child.code,
        name: child.name,
        difficulty: child.difficulty,
        parentId: linearEq.id,
      },
      update: {},
    });
  }

  console.log("✓ Curriculum seeded: 1 subject (math), 4 KPs");
  return { math, linearEq };
}
