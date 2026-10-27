/**
 * 答案正确性抽检基线：对最近 N 份已生成试卷调用 paper.checkAnswers（第二个模型判卷），
 * 统计 WRONG / UNCERTAIN 比例，并输出样例。结果写 docs/claude/eval/answer-accuracy-*.json。
 *
 * 用法（需 dev server + Postgres + 真实 DashScope）：
 *   cd apps/web && node scripts/verify-answer-accuracy.mjs [N=5]
 *
 * 只读不写题目；每个 tick 会调用一次 AI（qwen3.8-max，24 题一批评卷），成本远低于重新出卷。
 */
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "..", "docs", "claude", "eval");
mkdirSync(OUT_DIR, { recursive: true });
const BASE = "http://localhost:3000";
const LIMIT = Number(process.argv[2] ?? 5);

const envText = readFileSync(join(here, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const prisma = new PrismaClient();
const papers = await prisma.paper.findMany({
  where: { items: { some: {} } },
  orderBy: { createdAt: "desc" },
  take: LIMIT,
  select: { id: true, createdAt: true, _count: { select: { items: true } } },
});
if (papers.length === 0) {
  console.error("没有可抽检的试卷");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 });
await page.getByRole("button", { name: "密码登录" }).click();
await page.getByTestId("login-phone").fill("13800000002");
await page.getByTestId("login-password").fill("Teacher123!");
await page.getByTestId("login-password-submit").click();
await page.waitForURL((u) => u.pathname.startsWith("/teacher"), { timeout: 120000 });

const rows = [];
for (const paper of papers) {
  const resp = await page.evaluate(
    async ({ paperId }) => {
      const r = await fetch("/api/trpc/paper.checkAnswers?batch=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 0: { json: { paperId } } }),
      });
      return { status: r.status, body: await r.text() };
    },
    { paperId: paper.id },
  );
  let parsed;
  try {
    parsed = JSON.parse(resp.body);
  } catch {
    parsed = null;
  }
  const apiError = parsed?.[0]?.error?.json;
  const data = parsed?.[0]?.result?.data?.json;
  if (resp.status !== 200 || !data) {
    console.log(`${paper.id}: FAIL ${apiError?.message ?? resp.status}`);
    rows.push({ paperId: paper.id, ok: false, error: apiError?.message ?? `HTTP ${resp.status}` });
    continue;
  }
  const wrong = data.results.filter((r) => r.verdict === "WRONG");
  const uncertain = data.results.filter((r) => r.verdict === "UNCERTAIN");
  console.log(
    `${paper.id}: total=${data.total} wrong=${wrong.length} uncertain=${uncertain.length}` +
      (wrong.length ? ` | 例：第${wrong[0].questionNo}题 ${String(wrong[0].reason).slice(0, 40)}` : ""),
  );
  rows.push({
    paperId: paper.id,
    createdAt: paper.createdAt,
    items: paper._count.items,
    total: data.total,
    wrong: wrong.length,
    uncertain: uncertain.length,
    wrongSamples: wrong.slice(0, 3).map((r) => ({ questionNo: r.questionNo, reason: r.reason })),
  });
}

const okRows = rows.filter((r) => r.ok !== false && r.total > 0);
const total = okRows.reduce((n, r) => n + r.total, 0);
const wrong = okRows.reduce((n, r) => n + r.wrong, 0);
const uncertain = okRows.reduce((n, r) => n + r.uncertain, 0);
const summary = {
  checkedAt: new Date().toISOString(),
  papers: rows.length,
  okPapers: okRows.length,
  totalItems: total,
  wrong,
  uncertain,
  wrongRate: total ? Math.round((wrong / total) * 1000) / 10 : 0,
  uncertainRate: total ? Math.round((uncertain / total) * 1000) / 10 : 0,
  rows,
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
writeFileSync(join(OUT_DIR, `answer-accuracy-${stamp}.json`), JSON.stringify(summary, null, 2), "utf8");
writeFileSync(join(OUT_DIR, "answer-accuracy-latest.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(
  `\nSUMMARY papers=${summary.papers} items=${total} wrong=${wrong} (${summary.wrongRate}%) uncertain=${uncertain} (${summary.uncertainRate}%)`,
);
await browser.close();
process.exit(0);
