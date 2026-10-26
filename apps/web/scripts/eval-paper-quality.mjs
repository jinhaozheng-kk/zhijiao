/**
 * 试卷内容质量评测（12 场景基线）。
 *
 * 用法：
 *   cd apps/web && node scripts/eval-paper-quality.mjs            # 跑 12 个场景
 *   cd apps/web && node scripts/eval-paper-quality.mjs --limit=3  # 只跑前 3 个（快速冒烟）
 *
 * 需要：dev server 在 http://localhost:3000、Docker 里的 Postgres、真实 DASHSCOPE 配置。
 * 会真实消耗 AI 调用与 credits（每个场景约 5 credits + 配图调用）。
 *
 * 指标：生成是否成功/耗时、题数、总分、选择题 4 选项比例、解答题解析长度中位数、
 *       评分标准覆盖率、blockers/warnings、配图数；结果同时写 docs/claude/eval/。
 */
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "..", "docs", "claude", "eval");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "http://localhost:3000";
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 12;

const envText = readFileSync(join(here, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

/** 12 个场景：覆盖代数/几何/函数/统计概率、单 KP / 多 KP、不同难度倾向。 */
const SCENARIOS = [
  { name: "一次函数-单点", kps: ["一次函数"] },
  { name: "二次函数-单点", kps: ["二次函数"] },
  { name: "二次函数图象-单点", kps: ["二次函数的图象与性质"] },
  { name: "勾股定理-单点", kps: ["勾股定理"] },
  { name: "三角形-单点", kps: ["三角形"] },
  { name: "圆-单点", kps: ["圆"] },
  { name: "四边形-单点", kps: ["四边形"] },
  { name: "全等三角形-单点", kps: ["全等三角形"] },
  { name: "相似三角形-单点", kps: ["相似三角形的判定与性质"] },
  { name: "解直角三角形-单点", kps: ["解直角三角形"] },
  { name: "代数+几何混合", kps: ["一次函数", "三角形"] },
  { name: "函数+统计混合", kps: ["二次函数", "概率"] },
];

const prisma = new PrismaClient();

const LOG_FILE = join(OUT_DIR, "eval-progress.log");
function progress(message) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* ignore */
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

async function readPaperMetrics(paperId) {
  const paper = await withTimeout(
    prisma.paper.findUnique({
      where: { id: paperId },
      select: { paramsJson: true, items: { select: { type: true, points: true, optionsJson: true, solutionMd: true, rubricMd: true } } },
    }),
    30000,
    "readPaperMetrics",
  );
  const params = paper?.paramsJson ?? {};
  const items = paper?.items ?? [];
  const choice = items.filter((i) => i.type === "SINGLE_CHOICE" || i.type === "MULTI_CHOICE");
  const essays = items.filter((i) => i.type === "ESSAY");
  const solutions = essays.map((i) => (i.solutionMd ?? "").trim().length).sort((a, b) => a - b);
  const median = solutions.length ? solutions[Math.floor(solutions.length / 2)] : 0;
  const fourOptions = choice.filter((i) => Array.isArray(i.optionsJson) && i.optionsJson.length === 4).length;
  const withRubric = essays.filter((i) => (i.rubricMd ?? "").trim().length > 0).length;
  return {
    items: items.length,
    totalPoints: items.reduce((n, i) => n + i.points, 0),
    choiceCount: choice.length,
    choiceWith4Options: fourOptions,
    essayCount: essays.length,
    essaySolutionMedian: median,
    essaySolutionMin: solutions[0] ?? 0,
    essayWithRubric: withRubric,
    blockers: (params.reviewBlockers ?? []).length,
    warnings: (params.reviewWarnings ?? []).length,
    warningCodes: [...new Set((params.reviewWarnings ?? []).map((w) => w.code))],
    figures: Object.keys(params.figures ?? {}).length,
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", () => {});

await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "密码登录" }).click();
await page.getByTestId("login-phone").fill("13800000002");
await page.getByTestId("login-password").fill("Teacher123!");
await page.getByTestId("login-password-submit").click();
await page.waitForURL((u) => u.pathname.startsWith("/teacher"), { timeout: 120000 });
await withTimeout(prisma.$connect(), 15000, "prisma.connect").catch(() => {});
progress("login ok");

const results = [];
for (const [index, scenario] of SCENARIOS.slice(0, LIMIT).entries()) {
  const started = Date.now();
  progress(`scenario ${index + 1}/${LIMIT} ${scenario.name} start`);
  await page.goto(BASE + "/teacher/papers/new", { waitUntil: "domcontentloaded", timeout: 180000 });
  // 知识点 chips 是异步加载的（按钮出现 ≠ 知识点列表加载完）：等 chip 真正出现再点，
  // 否则会静默点空、所有场景退化成默认知识点（本轮评测踩过这个坑）。
  await page.waitForSelector('[data-testid^="kp-"]', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const selected = [];
  for (const kp of scenario.kps) {
    // 用 data-testid 前缀 + 文本匹配（getByRole 的 accessible name 在 chips 上不可靠）
    const chip = page.locator('[data-testid^="kp-"]').filter({ hasText: kp });
    if ((await chip.count()) > 0) {
      await chip.first().click({ timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(200);
      selected.push(kp);
    }
  }
  const HARD_TIMEOUT_MS = 8 * 60 * 1000;
  const outcome = await Promise.race([
    (async () => {
      await page.getByRole("button", { name: /一键生成中考风格卷/ }).click({ timeout: 30000 });
      await page.waitForURL(
        (u) => /^\/teacher\/papers\/[a-z0-9]+$/.test(u.pathname) && u.pathname !== "/teacher/papers/new",
        { timeout: HARD_TIMEOUT_MS },
      );
      return { ok: true, paperId: page.url().split("/").pop() };
    })(),
    (async () => {
      await page.locator('[data-testid="generate-error"]').waitFor({ state: "visible", timeout: HARD_TIMEOUT_MS });
      return { ok: false, error: (await page.locator('[data-testid="generate-error"]').innerText()).slice(0, 120) };
    })(),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "scenario timeout (8min)" }), HARD_TIMEOUT_MS)),
  ]).catch((error) => ({ ok: false, error: String(error).slice(0, 120) }));
  const seconds = Math.round((Date.now() - started) / 100);
  await page.waitForTimeout(800);
  progress(`scenario ${index + 1} outcome ${outcome.ok ? "OK " + outcome.paperId : "FAIL " + outcome.error} (${seconds / 10}s)`);

  // 失败/超时后页面可能仍停留在「生成中」状态，先硬跳回出卷页再进入下一场景，
  // 避免下一个场景因为按钮不在可点击状态而连环 FAIL（本轮评测里场景 12 就是这样挂的）。
  if (!outcome.ok) {
    await page.goto(BASE + "/teacher/papers", { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const row = {
    scenario: scenario.name,
    requestedKps: scenario.kps,
    selectedKps: selected,
    ok: outcome.ok,
    seconds: seconds / 10,
    ...(outcome.ok ? await readPaperMetrics(outcome.paperId).catch((e) => ({ metricsError: String(e).slice(0, 120) })) : { error: outcome.error }),
  };
  if (outcome.ok) row.paperId = outcome.paperId;
  results.push(row);
  progress(
    `${String(index + 1).padStart(2)}/${LIMIT} ${scenario.name}: ${row.ok ? "OK" : "FAIL"} ${row.seconds}s ` +
      (row.ok
        ? `items=${row.items} pts=${row.totalPoints} choice4=${row.choiceWith4Options}/${row.choiceCount} ` +
          `essaySolMedian=${row.essaySolutionMedian} rubric=${row.essayWithRubric}/${row.essayCount} ` +
          `warnings=${row.warnings}${row.warningCodes?.length ? "(" + row.warningCodes.join(",") + ")" : ""} figures=${row.figures}`
        : row.error),
  );
}

const okCount = results.filter((r) => r.ok).length;
const summary = {
  generatedAt: new Date().toISOString(),
  promptVersion: "v4",
  total: results.length,
  ok: okCount,
  successRate: results.length ? Math.round((okCount / results.length) * 1000) / 10 : 0,
  avgSeconds: results.length ? Math.round((results.reduce((n, r) => n + r.seconds, 0) / results.length) * 10) / 10 : 0,
  avgEssaySolutionMedian: (() => {
    const xs = results.filter((r) => r.ok).map((r) => r.essaySolutionMedian);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  })(),
  choice4OptionsRate: (() => {
    const rows = results.filter((r) => r.ok && r.choiceCount > 0);
    if (!rows.length) return 0;
    const good = rows.reduce((n, r) => n + r.choiceWith4Options, 0);
    const all = rows.reduce((n, r) => n + r.choiceCount, 0);
    return Math.round((good / all) * 1000) / 10;
  })(),
  results,
};
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT_DIR, `paper-quality-${stamp}.json`), JSON.stringify(summary, null, 2), "utf8");
console.log(
  `\nSUMMARY ${summary.ok}/${summary.total} (${summary.successRate}%) avg=${summary.avgSeconds}s ` +
    `choice4Options=${summary.choice4OptionsRate}% essaySolutionMedianAvg=${summary.avgEssaySolutionMedian}`,
);
// 说明：Prisma 的 query engine 在脚本模式下偶尔会卡住 $disconnect（Windows 上观察到的
// 现象），而截图/浏览器已无需清理——结果文件与进度日志都已落盘，直接退出，避免整条命令挂住。
process.exit(0);
