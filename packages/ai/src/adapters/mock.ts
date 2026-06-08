import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

// Default JSON outputs per taskKind. Tests that need adverse cases inject
// `respondWith`; happy-path callers (e.g. router smoke tests) rely on these
// defaults. Dispatched off the system message prefix to avoid coupling to
// taskKind plumbing — system prompts are stable contracts in router.ts.
const DEFAULT_TUTORING = {
  restatement: "求解一元一次方程。",
  knowledgePoints: ["一次方程求解"],
  steps: ["把常数移到等号一边", "两边同除以未知数系数"],
  pitfalls: ["注意符号"],
  finalAnswer: "x = 4",
};

const DEFAULT_TUTORING_IMAGE = {
  stemTranscript: "已知一次函数 y = 2x - 3，求它与 x 轴交点的横坐标。",
  ...DEFAULT_TUTORING,
};

const DEFAULT_ERROR_ANALYSIS = {
  rootCause: "CONCEPT_CONFUSION",
  reasoning: "Mock 分析：学生将类似概念混淆所致。",
  suggestedKnowledgePoints: ["一次方程基本概念"],
};

const DEFAULT_VARIANT_GENERATION = {
  items: [
    {
      level: "L1",
      stemMd: "解方程 3x + 7 = 19。",
      solutionMd: "x = 4。先移项 3x = 12，再两边同除 3。",
      knowledgePointHints: ["一次方程求解"],
    },
    {
      level: "L2",
      stemMd: "已知 3x + 7 = 19，求 6x - 1 的值。",
      solutionMd: "由原方程 x = 4，代入得 6x - 1 = 23。",
      knowledgePointHints: ["一次方程求解", "代数式求值"],
    },
    {
      level: "L3",
      stemMd: "小明买了 3 包薯片和 1 瓶 7 元的水共花 19 元，每包薯片多少钱？",
      solutionMd: "设薯片每包 x 元：3x + 7 = 19，解得 x = 4。",
      knowledgePointHints: ["一次方程应用题"],
    },
  ],
};

// Plan 9: kpReconcile 默认 mock —— 返回空数组（router 视作 "漏返" → retry → PARSE_FAILED）。
// 真实测试场景必须通过 `respondWith` 注入具体返值。
const DEFAULT_ASSIGNMENT_QUESTION_GENERATION = {
  title: "Linear equations tiered practice",
  tiers: [
    {
      level: "BASIC",
      rationaleMd: "Consolidate the core equation-solving structure.",
      items: [
        {
          type: "CALCULATION",
          stemMd: "Solve 2x + 5 = 13.",
          answerMd: "x = 4",
          solutionMd: "Move 5 to the right side, then divide by 2.",
          rubricMd: "Can isolate the unknown with correct inverse operations.",
          knowledgePointHints: ["linear equations"],
          difficulty: 2,
        },
      ],
    },
  ],
};

const DEFAULT_KP_RECONCILIATION: unknown = [];

const MOCK_PAPER_VARIANTS: Record<string, Array<{
  stemMd: string;
  answerMd: string;
  solutionMd: string;
  options?: string[];
  rubricMd?: string;
  knowledgePointHints: string[];
}>> = {
  SINGLE_CHOICE: [
    { stemMd: "下列函数中，属于一次函数的是（ ）", options: ["y=x^2", "y=2x+1", "y=1/x", "y=|x|"], answerMd: "B", solutionMd: "y=2x+1 形如 y=kx+b，且 k≠0。", knowledgePointHints: ["一次函数概念"] },
    { stemMd: "函数 y=-3x+5 的图象大致经过哪个象限判断最合理（ ）", options: ["第一、二、三象限", "第一、二、四象限", "第一、三、四象限", "第二、三、四象限"], answerMd: "B", solutionMd: "k<0，b>0，图象过第一、二、四象限。", knowledgePointHints: ["一次函数图象"] },
    { stemMd: "若一次函数 y=kx+2 随 x 增大而增大，则 k 的取值可为（ ）", options: ["-2", "0", "1", "无法确定"], answerMd: "C", solutionMd: "一次函数递增要求 k>0。", knowledgePointHints: ["一次函数性质"] },
  ],
  MULTI_CHOICE: [
    { stemMd: "下列关系式中，属于一次函数的有（ ）", options: ["y=2x", "y=2x+1", "y=x^2", "y=3"], answerMd: "AB", solutionMd: "形如 y=kx+b 且 k≠0 的是 A、B。", knowledgePointHints: ["一次函数概念"] },
    { stemMd: "关于函数 y=4x-1，下列说法正确的有（ ）", options: ["图象是一条直线", "y 随 x 增大而增大", "与 y 轴交于 -1", "经过原点"], answerMd: "ABC", solutionMd: "k=4>0，b=-1，不经过原点。", knowledgePointHints: ["一次函数图象", "一次函数性质"] },
    { stemMd: "一次函数解析式 y=kx+b 中，下列判断可能成立的有（ ）", options: ["k=0", "b=0", "k<0", "图象为直线"], answerMd: "BCD", solutionMd: "一次函数要求 k≠0，b 可以为 0，图象为直线。", knowledgePointHints: ["一次函数概念"] },
  ],
  FILL_BLANK: [
    { stemMd: "一次函数 y=2x+1 当 x=2 时，y=____。", answerMd: "5", solutionMd: "代入 x=2，得 y=2×2+1=5。", knowledgePointHints: ["一次函数求值"] },
    { stemMd: "直线 y=-x+3 与 y 轴的交点坐标是____。", answerMd: "(0, 3)", solutionMd: "令 x=0，得 y=3。", knowledgePointHints: ["一次函数图象"] },
    { stemMd: "若点 (1, m) 在直线 y=3x-2 上，则 m=____。", answerMd: "1", solutionMd: "代入 x=1，得 m=3×1-2=1。", knowledgePointHints: ["一次函数求值"] },
  ],
  CALCULATION: [
    { stemMd: "求一次函数 y=2x+1 当 x=2 时的函数值。", answerMd: "5", solutionMd: "代入 x=2，得 y=2×2+1=5。", knowledgePointHints: ["一次函数求值"] },
    { stemMd: "已知直线 y=kx+3 经过点 (2, 7)，求 k 的值。", answerMd: "2", solutionMd: "代入点坐标：7=2k+3，解得 k=2。", knowledgePointHints: ["待定系数法"] },
    { stemMd: "一次函数图象经过 (0, 1) 和 (1, 4)，求它的解析式。", answerMd: "y=3x+1", solutionMd: "设 y=kx+b，由 (0,1) 得 b=1，由 (1,4) 得 k=3。", knowledgePointHints: ["待定系数法"] },
  ],
  PROOF: [
    { stemMd: "证明函数 y=2x+1 是一次函数。", answerMd: "见解析", solutionMd: "该式符合 y=kx+b 且 k=2≠0，因此是一次函数。", rubricMd: "写出定义 5 分，指出 k≠0 5 分。", knowledgePointHints: ["一次函数概念"] },
    { stemMd: "说明 y=-x+4 的图象是一条直线。", answerMd: "见解析", solutionMd: "该函数是一次函数，一次函数的图象为直线。", rubricMd: "识别一次函数 5 分，说明图象特征 5 分。", knowledgePointHints: ["一次函数图象"] },
    { stemMd: "证明一次函数 y=3x-2 随 x 增大而增大。", answerMd: "见解析", solutionMd: "因为 k=3>0，所以函数值随自变量增大而增大。", rubricMd: "指出 k 值 4 分，说明单调性 6 分。", knowledgePointHints: ["一次函数性质"] },
  ],
  ESSAY: [
    { stemMd: "结合图象说明一次函数 y=2x+1 的主要性质。", answerMd: "见解析", solutionMd: "可从斜率、截距、单调性以及与坐标轴交点说明。", rubricMd: "每个性质点 2 分，表达清楚 2 分。", knowledgePointHints: ["一次函数图象"] },
    { stemMd: "用生活情境解释一次函数中 k 和 b 的含义。", answerMd: "见解析", solutionMd: "k 可表示变化率，b 可表示初始量。", rubricMd: "情境合理 4 分，解释 k 3 分，解释 b 3 分。", knowledgePointHints: ["一次函数应用"] },
    { stemMd: "比较正比例函数与一次函数的联系和区别。", answerMd: "见解析", solutionMd: "正比例函数是 b=0 的特殊一次函数，一次函数一般形式为 y=kx+b。", rubricMd: "联系 5 分，区别 5 分。", knowledgePointHints: ["一次函数概念"] },
  ],
};

function mockVariantForType(type: string, n: number) {
  const fallback = MOCK_PAPER_VARIANTS.ESSAY;
  if (!fallback) throw new Error("Mock paper ESSAY variants are not configured");
  const variants = MOCK_PAPER_VARIANTS[type] ?? fallback;
  const variant = variants[(n - 1) % variants.length]!;
  const cycle = Math.floor((n - 1) / variants.length);
  if (cycle === 0) return variant;
  const label = cycle.toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)]!);
  return { ...variant, stemMd: `${variant.stemMd}（拓展${label}）` };
}

function extractPaperKpNames(userContent: string): string[] {
  const match = userContent.match(/KP_NAMES_JSON:(\[[^\r\n]*\])/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]!) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function mockItemLabel(n: number): string {
  return n.toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)]!);
}

function mockVariantForKp(type: string, n: number, kpName: string) {
  const stemPrefix = `第${mockItemLabel(n).toUpperCase()}题：围绕“${kpName}”`;
  switch (type) {
    case "SINGLE_CHOICE":
      return {
        stemMd: `${stemPrefix}，下列说法正确的是（ ）。`,
        options: [
          `能根据“${kpName}”的规则完成判断`,
          "可以不看运算顺序直接从左到右计算所有题",
          "所有题都必须先算加减再算乘除",
          "括号不会改变计算顺序",
        ],
        answerMd: "A",
        solutionMd: `本题考查“${kpName}”。A 项体现了按相应规则分析和判断，其余选项表述过于绝对或不符合运算规则。`,
        knowledgePointHints: [kpName],
      };
    case "MULTI_CHOICE":
      return {
        stemMd: `${stemPrefix}，下列结论正确的有（ ）。`,
        options: [
          `解题时需要关注“${kpName}”中的关键规则`,
          "同级运算通常按从左到右的顺序进行",
          "有括号时一般先算括号内的部分",
          "任何情况下都可以随意交换运算顺序",
        ],
        answerMd: "ABC",
        solutionMd: `A、B、C 均符合“${kpName}”相关要求；D 忽略了运算规则和适用条件。`,
        knowledgePointHints: [kpName],
      };
    case "FILL_BLANK":
      return {
        stemMd: `${stemPrefix}，完成填空：解决这类问题时，应先明确____，再按规则计算。`,
        answerMd: "运算顺序",
        solutionMd: `“${kpName}”类问题通常需要先判断运算顺序或可用的运算律，再逐步计算。`,
        knowledgePointHints: [kpName],
      };
    case "CALCULATION":
      return {
        stemMd: `${stemPrefix}，计算并写出主要步骤：24 ÷ (3 + 1) + 6 × 2。`,
        answerMd: "18",
        solutionMd: `先算括号内 3 + 1 = 4，再算 24 ÷ 4 = 6，最后算 6 + 6 × 2 = 6 + 12 = 18。本题考查“${kpName}”。`,
        knowledgePointHints: [kpName],
      };
    case "PROOF":
      return {
        stemMd: `${stemPrefix}，说明为什么计算 25 × 16 × 4 可以先算 25 × 4。`,
        answerMd: "见解析。",
        solutionMd: `乘法满足交换律和结合律，可将 25 × 16 × 4 调整为 (25 × 4) × 16，从而简化计算。本题考查“${kpName}”。`,
        rubricMd: `指出可用运算律；说明调整顺序的理由；计算或表达清楚。`,
        knowledgePointHints: [kpName],
      };
    default:
      return {
        stemMd: `${stemPrefix}，结合一个例子说明解题时应注意哪些关键步骤。`,
        answerMd: "见解析。",
        solutionMd: `可从审题、确定规则、分步计算或推理、检查结果四个方面说明，重点围绕“${kpName}”。`,
        rubricMd: `能围绕“${kpName}”说明关键步骤，例子合理，表达清楚。`,
        knowledgePointHints: [kpName],
      };
  }
}

// Plan 17 / 统考排版：按请求 sections 造 mock 题，保证下游版式与题量正确。
function mockItemForType(type: string, n: number, kpName?: string) {
  const base = { difficulty: 2, cognitiveLevel: "UNDERSTAND" as const, points: 5 };
  const variant = kpName ? mockVariantForKp(type, n, kpName) : mockVariantForType(type, n);
  switch (type) {
    case "SINGLE_CHOICE":
      return { ...base, ...variant, type };
    case "MULTI_CHOICE":
      return { ...base, ...variant, type };
    case "FILL_BLANK":
      return { ...base, ...variant, type };
    case "CALCULATION":
      return { ...base, ...variant, points: 8, type };
    case "PROOF":
      return { ...base, ...variant, points: 10, type };
    default: // ESSAY 及其它
      return { ...base, ...variant, points: 10, type };
  }
}

function buildMockPaper(req: AdapterRequest): unknown {
  const user = req.messages.find((m) => m.role === "user")?.content ?? "";
  const kpNames = extractPaperKpNames(user);
  const m = user.match(/SECTIONS_JSON：(\[.*?\])/);
  if (m) {
    try {
      const sections = JSON.parse(m[1]!) as Array<{ type: string; count: number }>;
      const items: unknown[] = [];
      let n = 0;
      for (const s of sections) {
        for (let i = 0; i < s.count; i++) {
          const itemNo = ++n;
          const kpName =
            kpNames.length > 0
              ? kpNames[(itemNo - 1) % kpNames.length]
              : undefined;
          items.push(mockItemForType(s.type, itemNo, kpName));
        }
      }
      if (items.length > 0) return { title: `Mock ${(kpNames[0] ?? "一次函数")}练习卷`, items };
    } catch {
      // 落到下方兜底
    }
  }
  return {
    title: "Mock 一次函数练习卷",
    items: [mockItemForType("CALCULATION", 1), mockItemForType("SINGLE_CHOICE", 2)],
  };
}

// Plan 18: lesson-plan / courseware 默认 mock —— 五段齐全、合规。
const DEFAULT_LESSON_PLAN = {
  title: "Mock 一次函数课件",
  sections: [
    { type: "INTRO", title: "课堂导入", contentMd: "从生活中的匀速行驶引入。" },
    { type: "EXPLANATION", title: "讲解结构", contentMd: "一次函数 y=kx+b 的定义与图象。" },
    { type: "EXAMPLE", title: "例题", contentMd: "例：求 y=2x+1 当 x=2 的值。解：5。" },
    { type: "PITFALL", title: "易错点", contentMd: "混淆 k 与 b 的几何意义。" },
    { type: "EXERCISE", title: "课堂练习", contentMd: "练习：画出 y=-x+3 的图象。" },
  ],
};

// Plan 11: learning-advice 默认 mock —— schema 合法、措辞合规。
const DEFAULT_LEARNING_ADVICE = {
  summaryMd: "你最近在方程类题目上稳步推进，错题集中在少数知识点，方向很清晰。",
  suggestions: [
    {
      focusKp: "因式分解",
      methodMd: "先识别公因式，再判断能否套用平方差/完全平方公式；做完回看一步是否可逆验证。",
    },
  ],
  encouragementMd: "按自己的节奏一步步来，你已经在进步。",
};

function pickDefault(req: AdapterRequest): unknown {
  // System prompts are defined verbatim in router.ts; match on Chinese
  // 助手 suffix keyword to dispatch.
  const sys =
    req.messages.find((m) => m.role === "system")?.content ?? "";
  if (sys.includes("错因分析助手")) return DEFAULT_ERROR_ANALYSIS;
  if (sys.includes("举一反三变式生成助手")) return DEFAULT_VARIANT_GENERATION;
  if (sys.includes("知识点结构化的匹配助手")) return DEFAULT_KP_RECONCILIATION;
  if (sys.includes("assignment question generation assistant")) {
    return DEFAULT_ASSIGNMENT_QUESTION_GENERATION;
  }
  if (sys.includes("学习顾问")) return DEFAULT_LEARNING_ADVICE;
  if (sys.includes("拍照辅导助手")) return DEFAULT_TUTORING_IMAGE;
  if (sys.includes("练习卷命题助手")) return buildMockPaper(req);
  if (sys.includes("课件生成助手")) return DEFAULT_LESSON_PLAN;
  return DEFAULT_TUTORING;
}

export class MockAdapter implements ModelAdapter {
  name = "mock";

  constructor(
    private opts: {
      // 测试可注入指定响应；否则按 system message 关键词分发默认 JSON
      respondWith?: (
        req: AdapterRequest,
      ) => Promise<AdapterResponse> | AdapterResponse;
    } = {},
  ) {}

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    if (this.opts.respondWith) return this.opts.respondWith(req);
    return {
      content: JSON.stringify(pickDefault(req)),
      tokensIn: 100,
      tokensOut: 80,
      model: "mock-v1",
    };
  }
}
