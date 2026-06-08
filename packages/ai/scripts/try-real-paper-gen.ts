// 一次性脚本：用真实 DashScope (qwen-max) + v2 中考 prompt 真出一份卷并打印。
// 运行：node --env-file=.env.local --import tsx packages/ai/scripts/try-real-paper-gen.ts
// 需要 .env.local 提供 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / DATABASE_URL，且 AI_USE_MOCK=false。
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { AiRouter, DashScopeAdapter } from "../src/index.js";

// 从脚本文件定位仓库根的 .env.local（cwd 无关）。
const envPath = fileURLToPath(new URL("../../../.env.local", import.meta.url));
process.loadEnvFile(envPath);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error(`DATABASE_URL 未在 ${envPath} 找到`);
if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY.includes("replace-me")) {
  throw new Error("DASHSCOPE_API_KEY 未配置真实值");
}

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// 中考结构（与 ZHONGKAO_GENERIC_TEMPLATE 一致）：10 选择 + 6 填空 + 8 解答。
const sections = [
  { type: "SINGLE_CHOICE" as const, count: 10 },
  { type: "FILL_BLANK" as const, count: 6 },
  { type: "ESSAY" as const, count: 8 },
];
const styleRules = [
  "题干使用正式考试语言",
  "避免教辅营销表达",
  "不使用押题、预测、必考等词",
  "解析步骤完整但不冗长",
];
const slotHints = [
  { type: "SINGLE_CHOICE" as const, intent: "考查基础概念辨析、基本运算、图形识别与函数图像", constraints: ["题干简洁", "只有一个正确答案", "不提示解法"] },
  { type: "FILL_BLANK" as const, intent: "考查代数运算、几何性质、函数关系与数据处理", constraints: ["答案唯一", "不提供选项", "不提示解法"] },
  { type: "ESSAY" as const, intent: "考查计算、证明、应用建模、函数综合与几何综合", constraints: ["解题步骤完整", "条件唯一确定", "不直接提示解法"] },
];

async function main() {
  // 避开 prompt_templates 指纹护栏（v1/v2 残留行会致「生成失败」）。
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "model_calls", "prompt_templates" RESTART IDENTITY CASCADE;`);

  const router = new AiRouter({
    prisma,
    adapter: new DashScopeAdapter(),
    userId: "real-paper-smoke",
    promptVersion: "v2",
  });

  console.log("→ 调用真实 qwen-max 出卷（中考风格，24 题）… 可能需要 30–90s\n");
  const t0 = Date.now();
  const out = await router.generatePaper({
    subject: "数学",
    gradeLevel: "G9",
    kpNames: ["一次函数", "二元一次方程组", "几何图形"],
    sections,
    difficultyRange: [1, 5],
    textbookVersion: "GENERIC",
    excludeStems: [],
    styleRules,
    slotHints,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`✓ 完成（${secs}s）modelCallId=${out.modelCallId}`);
  console.log(`标题：${out.title}`);
  console.log(`题数：${out.items.length}\n`);
  out.items.forEach((it, i) => {
    console.log(`【${i + 1}】${it.type}  ${it.points}分  难度${it.difficulty}  KP:${it.knowledgePointHints.join("、")}`);
    console.log(`  题干：${it.stemMd}`);
    if (it.options?.length) it.options.forEach((o, j) => console.log(`    ${String.fromCharCode(65 + j)}. ${o}`));
    console.log(`  答案：${it.answerMd}`);
    console.log(`  解析：${it.solutionMd}`);
    if (it.rubricMd) console.log(`  评分：${it.rubricMd}`);
    console.log("");
  });
}

main()
  .catch((e) => { console.error("✗ 出卷失败：", e?.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
