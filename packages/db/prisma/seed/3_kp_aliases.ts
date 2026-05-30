import type { PrismaClient } from "@prisma/client";
import { mathKpRoots } from "./kp-data/index.js";
import { collectLeafAliases } from "./kp-data/types.js";

// Plan 13: alias 单一真源 = data 文件叶子的内联 aliases（已 normalize）。
// 不再手维护独立列表。全局唯一由 validateKpData（curriculum seed 时）保证。
export async function seedKpAliases(prisma: PrismaClient): Promise<void> {
  const subject = await prisma.subject.findUnique({ where: { code: "math" } });
  if (!subject) {
    console.warn("  ⚠️ subject math not found, skipping aliases");
    return;
  }

  const pairs = collectLeafAliases(mathKpRoots); // [{ kpCode, alias(normalized) }]
  let seeded = 0;
  for (const { kpCode, alias } of pairs) {
    const kp = await prisma.knowledgePoint.findUnique({
      where: { subjectId_code: { subjectId: subject.id, code: kpCode } },
    });
    if (!kp) {
      console.warn(`  ⚠️ kp ${kpCode} not found, skipping alias "${alias}"`);
      continue;
    }
    await prisma.kpAlias.upsert({
      where: { subjectId_normalizedAlias: { subjectId: subject.id, normalizedAlias: alias } },
      create: { subjectId: subject.id, kpId: kp.id, normalizedAlias: alias, source: "SEED" },
      update: { kpId: kp.id }, // 单一真源下可安全刷新归属（validateKpData 已保证无跨 KP 冲突）
    });
    seeded++;
  }
  console.log(`✓ KP aliases seeded: ${seeded} total (from data files)`);
}
