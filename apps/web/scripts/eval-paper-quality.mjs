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
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : [];

const envText = readFileSync(join(here, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

/**
 * 12 个场景：覆盖代数/几何/函数/统计概率。
 * 注意：中考蓝图是 24 题一张卷，KP 太窄会被「重复率过高」门拦下（400），
 * 所以每个场景给 4–5 个 KP（贴近真实中考卷的知识点覆盖度）。
 */
const SCENARIOS = [
  { name: "代数与方程综合", kps: ["一次方程求解", "一元二次方程", "二次根式", "实数", "一次方程应用题"] },
  { name: "一次函数综合", kps: ["一次函数", "一次方程应用题", "实数", "二次根式"] },
  { name: "二次函数综合", kps: ["二次函数", "二次函数的图象与性质", "一元二次方程", "实数"] },
  { name: "三角形与勾股", kps: ["三角形", "勾股定理", "全等三角形", "相似三角形的判定与性质"] },
  { name: "四边形综合", kps: ["四边形", "三角形", "相似三角形的判定与性质", "勾股定理"] },
  { name: "圆与相似", kps: ["圆", "相似三角形的判定与性质", "解直角三角形", "三角形"] },
  { name: "解直角三角形", kps: ["解直角三角形", "勾股定理", "三角形", "相似三角形的判定与性质"] },
  { name: "函数与方程", kps: ["一次函数", "二次函数", "一元二次方程", "反比例函数"] },
  { name: "概率统计", kps: ["概率", "统计", "实数", "一次方程求解"] },
  { name: "代数+几何混合", kps: ["一次函数", "三角形", "勾股定理", "二次根式"] },
  { name: "二次函数+几何", kps: ["二次函数", "四边形", "相似三角形的判定与性质", "三角形"] },
  { name: "综合模拟", kps: ["一次函数", "二次函数", "三角形", "圆", "概率"] },
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

/** 登录（可重复调用）：长跑评测里 session 会过期，每个场景前/遇 401 时重新登录。 */
async function ensureLogin() {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(500);
  const pwdButton = page.getByRole("button", { name: "密码登录" });
  // 已登录时 /login 可能直接重定向，没有登录表单
  if ((await pwdButton.count()) === 0) return;
  await pwdButton.click();
  await page.getByTestId("login-phone").fill("13800000002");
  await page.getByTestId("login-password").fill("Teacher123!");
  await page.getByTestId("login-password-submit").click();
  await page.waitForURL((u) => u.pathname.startsWith("/teacher"), { timeout: 120000 });
}

await ensureLogin();
await withTimeout(prisma.$connect(), 15000, "prisma.connect").catch(() => {});
progress("login ok");

// 直接从 DB 取学科与知识点 id，再用 tRPC 出卷。
// 不再点 UI chips：chips 选中态依赖默认选中集，单 KP 场景会被静默退化（历史评测踩过）。
const subject = await prisma.subject.findFirst({ where: { code: "math" }, select: { id: true } });
if (!subject) {
  console.error("找不到数学学科（subject.code=math）");
  process.exit(1);
}
const allKps = await prisma.knowledgePoint.findMany({
  where: { subjectId: subject.id },
  select: { id: true, name: true },
});
progress(`loaded subject=${subject.id} kps=${allKps.length}`);

const results = [];
// --only=勾股定理,三角形 可只跑指定场景（按名称包含匹配），用于针对性验证，不必等全量 12 场景。
const SELECTED = (ONLY.length ? SCENARIOS.filter((s) => ONLY.some((k) => s.name.includes(k))) : SCENARIOS).slice(0, LIMIT);
for (const [index, scenario] of SELECTED.entries()) {
  const started = Date.now();
  progress(`scenario ${index + 1}/${SELECTED.length} ${scenario.name} start`);
  // 场景 KP 名 → DB id（找不到的跳过并记录）
  const resolved = scenario.kps
    .map((name) => ({ name, id: allKps.find((k) => k.name === name)?.id }))
    .filter((entry) => Boolean(entry.id));
  const kpIds = resolved.map((entry) => entry.id);
  const selected = resolved.map((entry) => entry.name);
  const missing = scenario.kps.filter((name) => !selected.includes(name));
  if (missing.length > 0) progress(`  missing KPs: ${missing.join(",")}`);

  // 直接走 tRPC：body 与前端「一键生成中考风格卷」一致，避免 UI 交互不稳定。
  // 12 分钟上限：出卷(60-150s) + 审题修复轮(最多 2 轮) + 答案自愈闭环(抽检→修复→复检, ~2min)
  const HARD_TIMEOUT_MS = 12 * 60 * 1000;
  const generateViaApi = async () => {
    const resp = await page.evaluate(
      async ({ subjectId, kpIds }) => {
        const r = await fetch("/api/trpc/paper.generate?batch=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            0: {
              json: {
                subjectId,
                kpIds,
                gradeLevel: "G9",
                textbookVersion: "GENERIC",
                durationMinutes: 120,
                styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
                clientRequestId: crypto.randomUUID(),
              },
            },
          }),
        });
        return { status: r.status, body: await r.text() };
      },
      { subjectId: subject.id, kpIds },
    );
    let parsed;
    try {
      parsed = JSON.parse(resp.body);
    } catch {
      return { ok: false, error: `HTTP ${resp.status} 非 JSON 响应` };
    }
    const apiError = parsed?.[0]?.error?.json;
    if (resp.status !== 200) {
      const reason = apiError?.data?.cause?.reason ?? "";
      return { ok: false, error: `${apiError?.message ?? `HTTP ${resp.status}`}${reason ? ` [${reason}]` : ""}` };
    }
    const paperId = parsed?.[0]?.result?.data?.json?.paperId ?? parsed?.[0]?.result?.data?.paperId;
    return paperId ? { ok: true, paperId } : { ok: false, error: "响应中没有 paperId" };
  };
  const runOnce = () =>
    withTimeout(generateViaApi(), HARD_TIMEOUT_MS, "scenario").catch((error) => ({
      ok: false,
      error: String(error).slice(0, 140),
    }));

  let outcome = await runOnce();
  // 长跑评测里 JWT/session 会过期 → 重新登录后重试一次（否则后面场景会连环「请先登录」）。
  if (!outcome.ok && /请先登录|未登录|UNAUTHORIZED|401/.test(outcome.error)) {
    progress("  session expired → re-login & retry");
    await ensureLogin().catch(() => {});
    outcome = await runOnce();
  }

  const seconds = Math.round((Date.now() - started) / 100);
  progress(`scenario ${index + 1} outcome ${outcome.ok ? "OK " + outcome.paperId : "FAIL " + outcome.error} (${seconds / 10}s)`);

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
// 文件名带时间戳，避免不同批次互相覆盖；同时更新 latest 便于README/文档引用。
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = join(OUT_DIR, `paper-quality-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
writeFileSync(join(OUT_DIR, "paper-quality-latest.json"), JSON.stringify(summary, null, 2), "utf8");
progress(`results written: ${outPath}`);
console.log(
  `\nSUMMARY ${summary.ok}/${summary.total} (${summary.successRate}%) avg=${summary.avgSeconds}s ` +
    `choice4Options=${summary.choice4OptionsRate}% essaySolutionMedianAvg=${summary.avgEssaySolutionMedian}`,
);
// 说明：Prisma 的 query engine 在脚本模式下偶尔会卡住 $disconnect（Windows 上观察到的
// 现象），而截图/浏览器已无需清理——结果文件与进度日志都已落盘，直接退出，避免整条命令挂住。
process.exit(0);
