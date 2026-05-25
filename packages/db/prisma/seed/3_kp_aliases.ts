import type { PrismaClient } from "@prisma/client";

// Plan 9 spec §7.1: 仅覆盖当前 seed 的 math KP，每个 2-3 条高确定别名。
// 不扩到 50-100 条 —— alias 质量比数量重要，乱塞同义词会误自动匹配。
// 后续靠 CLI kp:review 的 alias <kpCode> 慢慢沉淀。

function normalizeKpHint(s: string): string {
  // Mirror apps/web/server/lib/kp-reconcile.ts → normalizeKpHint。
  // 不复用 import 是因为 seed 在 packages/db 跑、不依赖 apps/web。
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

const ALIASES: Array<{
  subjectCode: string;
  kpCode: string;
  aliases: string[];
}> = [
  {
    subjectCode: "math",
    kpCode: "math-g8-linear-eq-solve",
    aliases: ["一元一次方程", "linear equation", "一次方程"],
  },
  {
    subjectCode: "math",
    kpCode: "math-g8-linear-eq-apply",
    aliases: ["一次方程应用题", "linear equation word problem"],
  },
  {
    subjectCode: "math",
    kpCode: "math-g8-linear-eq-system",
    aliases: ["二元一次方程组", "system of equations", "方程组"],
  },
];

export async function seedKpAliases(prisma: PrismaClient): Promise<void> {
  let totalSeeded = 0;
  for (const item of ALIASES) {
    const subject = await prisma.subject.findUnique({
      where: { code: item.subjectCode },
    });
    if (!subject) {
      console.warn(`  ⚠️ subject ${item.subjectCode} not found, skipping aliases`);
      continue;
    }
    const kp = await prisma.knowledgePoint.findUnique({
      where: { subjectId_code: { subjectId: subject.id, code: item.kpCode } },
    });
    if (!kp) {
      console.warn(`  ⚠️ kp ${item.kpCode} not found in subject ${item.subjectCode}, skipping`);
      continue;
    }
    for (const raw of item.aliases) {
      const normalized = normalizeKpHint(raw);
      await prisma.kpAlias.upsert({
        where: {
          subjectId_normalizedAlias: {
            subjectId: subject.id,
            normalizedAlias: normalized,
          },
        },
        create: {
          subjectId: subject.id,
          kpId: kp.id,
          normalizedAlias: normalized,
          source: "SEED",
        },
        update: {},
      });
      totalSeeded++;
    }
    console.log(`  ✓ Seeded ${item.aliases.length} aliases for ${item.kpCode}`);
  }
  console.log(`✓ KP aliases seeded: ${totalSeeded} total`);
}
