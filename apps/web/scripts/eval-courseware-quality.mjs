/**
 * AI 课件内容质量评测（真实 DashScope + 真实 tRPC 生成）。
 *
 * 用法：
 *   cd apps/web && node scripts/eval-courseware-quality.mjs              # 跑全部场景
 *   cd apps/web && node scripts/eval-courseware-quality.mjs --limit=2    # 快速冒烟
 *   cd apps/web && node scripts/eval-courseware-quality.mjs --only=一次函数,勾股
 *   cd apps/web && node scripts/eval-courseware-quality.mjs --tag=after-v2
 *
 * 需要：dev server 在 http://localhost:3000、Postgres、真实 DASHSCOPE 配置（AI_USE_MOCK=false）。
 * 每个场景固定消耗 LESSON_PLAN_GEN 3 credits。
 *
 * 指标：成功率/耗时、五段各自字数（min/median）、字面量 \n / Markdown 结构 / 公式数 /
 *       例题步骤与练习答案覆盖、禁词命中；同时截预览页与打印页（PDF 页数）便于人工比对。
 */
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "..", "docs", "claude", "eval");
const SHOT_DIR = join(OUT_DIR, "courseware-shots");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const BASE = "http://localhost:3000";
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`));
const LIMIT = arg("limit") ? Number(arg("limit").split("=")[1]) : 8;
const ONLY = arg("only")
  ? arg("only").split("=")[1].split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const TAG = arg("tag") ? arg("tag").split("=")[1] : "run";

const envText = readFileSync(join(here, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

/**
 * 8 个场景：覆盖代数 / 函数 / 几何 / 统计，年级 G7–G9，含「一个 KP」「多个 KP」「带教学目标」三种输入。
 */
const SCENARIOS = [
  {
    name: "一次函数-单KP",
    gradeLevel: "G8",
    kps: ["一次函数"],
    teachingGoal: "理解 y=kx+b 中 k、b 的几何意义，能根据图象判断增减性",
  },
  {
    name: "二次函数图象-多KP",
    gradeLevel: "G9",
    kps: ["二次函数", "二次函数的图象与性质"],
    teachingGoal: "能画出抛物线草图并说明开口方向、对称轴与顶点",
  },
  {
    name: "勾股定理-单KP",
    gradeLevel: "G8",
    kps: ["勾股定理"],
    teachingGoal: "会用勾股定理解决直角三角形边长计算问题",
  },
  {
    name: "全等三角形-多KP",
    gradeLevel: "G8",
    kps: ["全等三角形", "三角形"],
    teachingGoal: "掌握 SSS/SAS/ASA/AAS 判定，能规范书写证明过程",
  },
  {
    name: "圆与相似-多KP",
    gradeLevel: "G9",
    kps: ["圆", "相似三角形的判定与性质"],
    teachingGoal: "能利用相似三角形解决圆中的线段比例问题",
  },
  {
    name: "一元二次方程-单KP",
    gradeLevel: "G9",
    kps: ["一元二次方程"],
    teachingGoal: "掌握配方法、公式法与因式分解法解一元二次方程",
  },
  {
    name: "概率统计-多KP",
    gradeLevel: "G9",
    kps: ["概率", "统计", "实数"],
    teachingGoal: "理解频率与概率的关系，能用列表法求简单事件概率",
  },
  {
    name: "无教学目标-单KP",
    gradeLevel: "G7",
    kps: ["一次方程求解"],
    teachingGoal: null,
  },
];

const prisma = new PrismaClient();
const LOG_FILE = join(OUT_DIR, "courseware-progress.log");
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

const SECTION_TYPES = ["INTRO", "EXPLANATION", "EXAMPLE", "PITFALL", "EXERCISE"];
const FORBIDDEN = ["提分", "涨分", "必考", "保过", "通过保证", "押题", "分数承诺"];

/** 从 DB 读回已落库课件，算内容形态指标。 */
async function readCoursewareMetrics(coursewareId) {
  const cw = await withTimeout(
    prisma.courseware.findUnique({
      where: { id: coursewareId },
      select: {
        title: true,
        status: true,
        paramsJson: true,
        sections: { select: { type: true, title: true, contentMd: true } },
      },
    }),
    30000,
    "readCoursewareMetrics",
  );
  if (!cw) return { metricsError: "courseware not found" };
  const byType = Object.fromEntries(cw.sections.map((s) => [s.type, s]));
  const sections = SECTION_TYPES.map((type) => {
    const s = byType[type];
    const raw = s?.contentMd ?? "";
    return {
      type,
      title: s?.title ?? "",
      len: raw.length,
      literalBackslashN: (raw.match(/\\+n/g) ?? []).length,
      headings: (raw.match(/^#{1,6}\s/gm) ?? []).length,
      listItems: (raw.match(/^\s*(?:[-*]|\d+[.、])\s/gm) ?? []).length,
      bold: (raw.match(/\*\*/g) ?? []).length,
      latex: (raw.match(/\$[^$]+\$/g) ?? []).length,
      hasAnswer: /答案|解析|解[:：]|答[:：]/.test(raw),
      hasSteps: /(①|②|③|第一步|第二步|步骤|解[:：])/.test(raw),
    };
  });
  const lens = sections.map((s) => s.len).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  const totalChars = lens.reduce((n, v) => n + v, 0);
  const body = sections.map((s) => byType[s.type]?.contentMd ?? "").join("\n");
  return {
    title: cw.title,
    status: cw.status,
    sectionLens: Object.fromEntries(sections.map((s) => [s.type, s.len])),
    totalChars,
    medianSectionLen: median,
    minSectionLen: lens[0] ?? 0,
    literalBackslashN: sections.reduce((n, s) => n + s.literalBackslashN, 0),
    headings: sections.reduce((n, s) => n + s.headings, 0),
    listItems: sections.reduce((n, s) => n + s.listItems, 0),
    bold: sections.reduce((n, s) => n + s.bold, 0),
    latex: sections.reduce((n, s) => n + s.latex, 0),
    exampleHasSteps: Boolean(byType.EXAMPLE?.contentMd && /(解[:：]|步骤|①|由.{0,20}得)/.test(byType.EXAMPLE.contentMd)),
    exerciseHasAnswer: Boolean(byType.EXERCISE?.contentMd && /(答案|解析|解[:：]|答[:：]|提示)/.test(byType.EXERCISE.contentMd)),
    forbiddenHits: FORBIDDEN.filter((w) => body.includes(w)),
    sections,
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", () => {});

async function ensureLogin() {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(400);
  const pwdButton = page.getByRole("button", { name: "密码登录" });
  if ((await pwdButton.count()) === 0) return;
  await pwdButton.click();
  await page.getByTestId("login-phone").fill("13800000002");
  await page.getByTestId("login-password").fill("Teacher123!");
  await page.getByTestId("login-password-submit").click();
  await page.waitForURL((u) => u.pathname.startsWith("/teacher"), { timeout: 120000 });
}

await ensureLogin();
await withTimeout(prisma.$connect(), 15000, "prisma.connect").catch(() => {});
progress(`login ok tag=${TAG} mock=${process.env.AI_USE_MOCK ?? "(unset)"}`);

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

const SELECTED = (ONLY.length
  ? SCENARIOS.filter((s) => ONLY.some((k) => s.name.includes(k)))
  : SCENARIOS
).slice(0, LIMIT);

const results = [];
for (const [index, scenario] of SELECTED.entries()) {
  const started = Date.now();
  progress(`scenario ${index + 1}/${SELECTED.length} ${scenario.name} start`);
  const resolved = scenario.kps
    .map((name) => ({ name, id: allKps.find((k) => k.name === name)?.id }))
    .filter((entry) => Boolean(entry.id));
  const kpIds = resolved.map((entry) => entry.id);
  const selected = resolved.map((entry) => entry.name);
  const missing = scenario.kps.filter((name) => !selected.includes(name));
  if (missing.length > 0) progress(`  missing KPs: ${missing.join(",")}`);
  if (kpIds.length === 0) {
    progress(`  skip: no resolvable KP`);
    results.push({ scenario: scenario.name, ok: false, error: "no resolvable KP" });
    continue;
  }

  const HARD_TIMEOUT_MS = 6 * 60 * 1000;
  const generateViaApi = async () => {
    const resp = await page.evaluate(
      async ({ subjectId, kpIds, gradeLevel, teachingGoal }) => {
        const r = await fetch("/api/trpc/courseware.generate?batch=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            0: {
              json: {
                subjectId,
                kpIds,
                gradeLevel,
                ...(teachingGoal ? { teachingGoal } : {}),
                clientRequestId: crypto.randomUUID(),
              },
            },
          }),
        });
        return { status: r.status, body: await r.text() };
      },
      { subjectId: subject.id, kpIds, gradeLevel: scenario.gradeLevel, teachingGoal: scenario.teachingGoal },
    );
    let parsed;
    try {
      parsed = JSON.parse(resp.body);
    } catch {
      return { ok: false, error: `HTTP ${resp.status} 非 JSON 响应: ${resp.body.slice(0, 120)}` };
    }
    const apiError = parsed?.[0]?.error?.json;
    if (resp.status !== 200) {
      const reason = apiError?.data?.cause?.reason ?? "";
      const blockers = apiError?.data?.cause?.blockers;
      return {
        ok: false,
        error: `${apiError?.message ?? `HTTP ${resp.status}`}${reason ? ` [${reason}]` : ""}${
          blockers ? ` blockers=${JSON.stringify(blockers).slice(0, 160)}` : ""
        }`,
      };
    }
    const coursewareId =
      parsed?.[0]?.result?.data?.json?.coursewareId ?? parsed?.[0]?.result?.data?.coursewareId;
    return coursewareId ? { ok: true, coursewareId } : { ok: false, error: "响应中没有 coursewareId" };
  };
  const runOnce = () =>
    withTimeout(generateViaApi(), HARD_TIMEOUT_MS, "scenario").catch((error) => ({
      ok: false,
      error: String(error).slice(0, 160),
    }));

  let outcome = await runOnce();
  if (!outcome.ok && /请先登录|未登录|UNAUTHORIZED|401/.test(outcome.error)) {
    progress("  session expired → re-login & retry");
    await ensureLogin().catch(() => {});
    outcome = await runOnce();
  }

  const seconds = Math.round((Date.now() - started) / 100) / 10;
  progress(
    `scenario ${index + 1} outcome ${outcome.ok ? "OK " + outcome.coursewareId : "FAIL " + outcome.error} (${seconds}s)`,
  );

  const row = {
    scenario: scenario.name,
    gradeLevel: scenario.gradeLevel,
    requestedKps: scenario.kps,
    selectedKps: selected,
    teachingGoal: scenario.teachingGoal,
    ok: outcome.ok,
    seconds,
    ...(outcome.ok ? await readCoursewareMetrics(outcome.coursewareId) : { error: outcome.error }),
  };
  if (outcome.ok) {
    row.coursewareId = outcome.coursewareId;
    // 预览页 + 打印页截图（真实渲染，供人工比对 Markdown/公式/版式）
    const slug = `${TAG}-${String(index + 1).padStart(2, "0")}-${scenario.name}`;
    try {
      await page.goto(`${BASE}/teacher/coursewares/${outcome.coursewareId}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(800);
      row.previewShot = join("courseware-shots", `${slug}-preview.png`);
      await page.screenshot({ path: join(SHOT_DIR, `${slug}-preview.png`), fullPage: true });
      await page.goto(`${BASE}/teacher/coursewares/${outcome.coursewareId}/print`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(800);
      row.printShot = join("courseware-shots", `${slug}-print.png`);
      await page.screenshot({ path: join(SHOT_DIR, `${slug}-print.png`), fullPage: true });
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      row.printPdfPages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    } catch (e) {
      row.shotError = String(e).slice(0, 160);
    }
  }
  results.push(row);
  progress(
    `${String(index + 1).padStart(2)}/${SELECTED.length} ${scenario.name}: ${row.ok ? "OK" : "FAIL"} ${row.seconds}s ` +
      (row.ok
        ? `totalChars=${row.totalChars} median=${row.medianSectionLen} min=${row.minSectionLen} ` +
          `literalN=${row.literalBackslashN} md(heading/list/bold)=${row.headings}/${row.listItems}/${row.bold} ` +
          `latex=${row.latex} exampleSteps=${row.exampleHasSteps} exerciseAns=${row.exerciseHasAnswer} ` +
          `pages=${row.printPdfPages ?? "?"} forbidden=${row.forbiddenHits?.join(",") || "-"}`
        : row.error),
  );
}

const okRows = results.filter((r) => r.ok);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
const summary = {
  generatedAt: new Date().toISOString(),
  tag: TAG,
  total: results.length,
  ok: okRows.length,
  successRate: results.length ? Math.round((okRows.length / results.length) * 1000) / 10 : 0,
  avgSeconds: avg(results.map((r) => r.seconds)),
  avgTotalChars: avg(okRows.map((r) => r.totalChars)),
  avgMedianSectionLen: avg(okRows.map((r) => r.medianSectionLen)),
  avgMinSectionLen: avg(okRows.map((r) => r.minSectionLen)),
  scenarioSectionMinTotal: results.length
    ? SECTION_TYPES.reduce((acc, type) => {
        const xs = okRows.map((r) => r.sectionLens?.[type] ?? 0).filter((n) => n > 0);
        return { ...acc, [type]: xs.length ? Math.min(...xs) : 0 };
      }, {})
    : {},
  literalBackslashNTotal: okRows.reduce((n, r) => n + r.literalBackslashN, 0),
  exampleStepsRate: okRows.length
    ? Math.round((okRows.filter((r) => r.exampleHasSteps).length / okRows.length) * 1000) / 10
    : 0,
  exerciseAnswerRate: okRows.length
    ? Math.round((okRows.filter((r) => r.exerciseHasAnswer).length / okRows.length) * 1000) / 10
    : 0,
  forbiddenHitScenarios: okRows.filter((r) => r.forbiddenHits?.length).map((r) => r.scenario),
  results,
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = join(OUT_DIR, `courseware-quality-${stamp}-${TAG}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
writeFileSync(join(OUT_DIR, "courseware-quality-latest.json"), JSON.stringify(summary, null, 2), "utf8");
progress(`results written: ${outPath}`);
console.log(
  `\nSUMMARY tag=${TAG} ${summary.ok}/${summary.total} (${summary.successRate}%) avg=${summary.avgSeconds}s ` +
    `totalChars=${summary.avgTotalChars} medianSection=${summary.avgMedianSectionLen} ` +
    `minSection=${summary.avgMinSectionLen} literalN=${summary.literalBackslashNTotal} ` +
    `steps=${summary.exampleStepsRate}% exerciseAns=${summary.exerciseAnswerRate}%`,
);
process.exit(0);
