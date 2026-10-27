/**
 * 临时探针：统计现有 Courseware 内容形态（长度 / 字面量换行 / Markdown 结构 / 练习答案覆盖率）。
 * 用法：cd apps/web && node scripts/_tmp-courseware-baseline.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(here, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const prisma = new PrismaClient();
const rows = await prisma.courseware.findMany({
  orderBy: { createdAt: "desc" },
  take: 10,
  select: {
    id: true,
    title: true,
    status: true,
    gradeLevel: true,
    createdAt: true,
    paramsJson: true,
    sections: { orderBy: { position: "asc" }, select: { type: true, title: true, contentMd: true } },
  },
});

console.log(`coursewares=${rows.length}`);
for (const cw of rows) {
  console.log(`\n## ${cw.title} [${cw.status}] ${cw.gradeLevel} ${cw.createdAt.toISOString()} id=${cw.id}`);
  console.log(`params=${JSON.stringify(cw.paramsJson)}`);
  for (const s of cw.sections) {
    const raw = s.contentMd;
    const literalN = (raw.match(/\\+n/g) ?? []).length;
    const headings = (raw.match(/^#{1,6}\s/gm) ?? []).length;
    const listItems = (raw.match(/^\s*[-*]\s/gm) ?? []).length;
    const bold = (raw.match(/\*\*/g) ?? []).length;
    const latex = (raw.match(/\$[^$]+\$/g) ?? []).length;
    const answers = /答案|解析|解：|答：|参考答案/.test(raw);
    console.log(
      `  ${s.type.padEnd(12)} len=${String(raw.length).padStart(5)} literalN=${literalN} heading=${headings} list=${listItems} bold=${bold} latex=${latex} answers=${answers} | ${s.title}`,
    );
    console.log(
      "    preview: " + raw.replace(/\n/g, "⏎").slice(0, 180),
    );
  }
}
await prisma.$disconnect();
process.exit(0);
