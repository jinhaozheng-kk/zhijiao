import { PrismaClient } from "@prisma/client";
import { mathKpRoots, type KpNode } from "./kp-data/index.js";
import { validateKpData } from "./kp-data/types.js";

// 深度优先 upsert KP 树。按 (subjectId, code) 幂等：重跑只刷 name/difficulty/parentId。
async function seedSubjectKpTree(
  prisma: PrismaClient,
  subjectId: string,
  nodes: KpNode[],
  parentId: string | null,
): Promise<number> {
  let count = 0;
  for (const node of nodes) {
    const isLeaf = !node.children || node.children.length === 0;
    const difficulty = isLeaf ? node.difficulty ?? 3 : 3; // 容器 difficulty 无意义，取 default 3
    const row = await prisma.knowledgePoint.upsert({
      where: { subjectId_code: { subjectId, code: node.code } },
      create: { subjectId, code: node.code, name: node.name, difficulty, parentId },
      update: { name: node.name, difficulty, parentId },
    });
    count++;
    if (node.children?.length) {
      count += await seedSubjectKpTree(prisma, subjectId, node.children, row.id);
    }
  }
  return count;
}

export async function seedCurriculum(prisma: PrismaClient) {
  // 数据自检：坏数据（重复 code/alias、容器带 alias）直接 throw，不静默 seed。
  validateKpData(mathKpRoots);

  const math = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });

  const total = await seedSubjectKpTree(prisma, math.id, mathKpRoots, null);

  console.log(`✓ Curriculum seeded: 1 subject (math), ${total} KPs (全学段树)`);
  return { math };
}
