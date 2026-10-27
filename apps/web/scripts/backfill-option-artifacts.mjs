/**
 * 清理存量试卷选项里的 HTML 实体/分隔符残留（如 `A. 1 &emsp`、`B. 2 &nbsp;`、行尾孤立 `&`）。
 *
 * 用法：
 *   dry-run（默认）：node scripts/backfill-option-artifacts.mjs
 *   实际写入：        node scripts/backfill-option-artifacts.mjs --apply
 *
 * 说明：新生成的数据已在 @zhijiao/ai 的 coerceOptionArray/normalizeAiText 里清洗；
 * 这个脚本只处理历史数据。清理逻辑与 packages/ai/src/schemas.ts 的 stripHtmlEntities 保持一致。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const ENTITY_SPACE = /&(?:emsp|ensp|nbsp|thinsp|#160|#8195|#8201);?/gi;
const ENTITY_BASIC = /&(amp|lt|gt|quot|#39);/gi;
const BASIC_MAP = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

function cleanOption(raw) {
  return String(raw)
    .replace(ENTITY_SPACE, " ")
    .replace(ENTITY_BASIC, (_, name) => BASIC_MAP[name.toLowerCase()] ?? "")
    .replace(/\s*&\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const papers = await prisma.paper.findMany({
  where: { items: { some: { optionsJson: { not: null } } } },
  select: { id: true, items: { select: { id: true, position: true, optionsJson: true } } },
});

let changedPapers = 0;
let changedItems = 0;
let examples = [];

for (const paper of papers) {
  for (const item of paper.items) {
    const options = item.optionsJson;
    if (!Array.isArray(options)) continue;
    const cleaned = options.map((opt) => (typeof opt === "string" ? cleanOption(opt) : opt));
    const isClean = cleaned.every((opt, i) => opt === options[i]);
    if (isClean) continue;
    changedItems += 1;
    if (examples.length < 5) {
      examples.push(
        `paper=${paper.id} Q${item.position}: ${JSON.stringify(options).slice(0, 90)} → ${JSON.stringify(cleaned).slice(0, 90)}`,
      );
    }
    if (APPLY) {
      await prisma.paperItem.update({ where: { id: item.id }, data: { optionsJson: cleaned } });
    }
  }
  if (APPLY && paper.items.some((item) => Array.isArray(item.optionsJson) && item.optionsJson.some((opt) => typeof opt === "string" && cleanOption(opt) !== opt))) {
    changedPapers += 1;
  }
}

console.log(`mode=${APPLY ? "APPLY" : "DRY-RUN"} papersScanned=${papers.length} itemsToFix=${changedItems}`);
for (const example of examples) console.log("  " + example);
console.log(`dry-run only; re-run with --apply to write.`);
await prisma.$disconnect();
process.exit(0);
