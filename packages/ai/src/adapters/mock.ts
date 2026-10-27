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
// 注意：mock 题也要满足「解答题解析 ≥80 字」的内容质量门（否则审题 BLOCKER 会拖垮
// 依赖 mock 的集成/E2E 测试）；真实模型由 prompt v4 + 修复轮保证。
const MOCK_LONG_SOLUTION =
  "设未知数为 x，根据题意列出关系式，化简后求解得到 x 的值，再代回原题检验并写出结论。" +
  "（第一步设元，第二步列式，第三步解方程，第四步检验作答，各步均写出必要过程。）";
const MOCK_ESSAY_META = {
  solutionMd: MOCK_LONG_SOLUTION,
  rubricMd: "设未知数 2 分；列关系式 3 分；求解 3 分；检验作答 2 分。",
};

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
      return { ...base, ...variant, ...MOCK_ESSAY_META, points: 8, type };
    case "PROOF":
      return { ...base, ...variant, points: 10, type };
    default: // ESSAY 及其它
      return { ...base, ...variant, ...MOCK_ESSAY_META, points: 10, type };
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
// 质量门（apps/web/server/lib/courseware-review.ts）会拦「过短/例题无解答/练习无答案」，
// 所以 mock 必须是一份「可直接进课堂」的完整课件，否则依赖 mock 的集成/E2E 会被误伤。
const DEFAULT_LESSON_PLAN = {
  title: "八年级数学 · 一次函数的图象与性质",
  sections: [
    {
      type: "INTRO",
      title: "课堂导入：从匀速行驶说起",
      contentMd:
        "（约 5 分钟）\n\n一辆汽车以每小时 60 千米的速度在高速公路上匀速行驶，行驶时间记为 $t$ 小时，行驶路程记为 $s$ 千米。\n\n请思考：\n1. $s$ 与 $t$ 之间满足什么关系？\n2. 当 $t=2$ 时，路程是多少？当 $t=3.5$ 时呢？\n3. 如果把 $s$ 看作 $t$ 的函数，这个函数的图象会是什么形状？\n\n今天我们就来研究这类「$y=kx+b$」形式的函数——一次函数：它的表达式、图象，以及 $k$、$b$ 各自决定了图象的什么特征。本节课的目标是：能说出 $k$、$b$ 的几何意义，能根据图象判断函数的增减性，并能解决简单的实际问题。",
    },
    {
      type: "EXPLANATION",
      title: "讲解结构：定义、图象与 k、b 的意义",
      contentMd:
        "（约 15 分钟）\n\n### 一、一次函数的定义\n\n形如 $y=kx+b$（$k$、$b$ 是常数，$k\\neq 0$）的函数叫做一次函数；当 $b=0$ 时，$y=kx$ 是正比例函数，它是一次函数的特例。\n\n教师追问：「$k=0$ 时为什么不算一次函数？」预设回答：此时 $y=b$ 是常函数，图象是水平直线，没有「一次」的变化关系。\n\n### 二、图象是直线\n\n在坐标系中取两组对应值，描点、连线，可以得到一条直线。\n\n- 当 $k>0$ 时，$y$ 随 $x$ 的增大而增大，直线自左下向右上倾斜；\n- 当 $k<0$ 时，$y$ 随 $x$ 的增大而减小，直线自左上向右下倾斜；\n- $|k|$ 越大，直线越陡；$|k|$ 越小，直线越平缓。\n\n### 三、$b$ 的几何意义\n\n令 $x=0$，得 $y=b$，所以直线必过点 $(0,b)$，$b$ 是直线与 $y$ 轴交点的纵坐标（截距）。$b>0$ 时交点在 $y$ 轴正半轴，$b<0$ 时在负半轴，$b=0$ 时过原点。\n\n### 四、板书要点\n\n1. 定义：$y=kx+b$，$k\\neq 0$；\n2. $k$ 定方向与陡缓，$b$ 定与 $y$ 轴的交点；\n3. 画图三步：列表 → 描点 → 连线。",
    },
    {
      type: "EXAMPLE",
      title: "例题：判断增减性并求交点",
      contentMd:
        "（约 12 分钟）\n\n**例 1（基础）** 已知一次函数 $y=2x-3$。\n\n思路分析：先由 $k$ 的符号判断增减性，再令 $x=0$ 求与 $y$ 轴的交点。\n\n分步解答：\n1. $k=2>0$，所以 $y$ 随 $x$ 的增大而增大；\n2. 令 $x=0$，得 $y=-3$，所以图象与 $y$ 轴交于点 $(0,-3)$；\n3. 再令 $y=0$，得 $x=\\dfrac{3}{2}$，所以与 $x$ 轴交于 $\\left(\\dfrac{3}{2},0\\right)$。\n\n方法总结：判断增减性看 $k$ 的符号；求截距令 $x=0$；求与 $x$ 轴交点令 $y=0$。\n\n**例 2（变式）** 已知一次函数图象经过点 $(1,5)$ 和 $(3,9)$，求它的表达式。\n\n思路分析：设 $y=kx+b$，把两点坐标代入得到关于 $k$、$b$ 的方程组。\n\n分步解答：\n1. 设 $y=kx+b$；\n2. 代入得 $\\begin{cases} k+b=5 \\\\ 3k+b=9 \\end{cases}$；\n3. 两式相减得 $2k=4$，即 $k=2$；\n4. 代回得 $b=3$，所以 $y=2x+3$。\n\n方法总结：求一次函数表达式用待定系数法：设、代、解、写。",
    },
    {
      type: "PITFALL",
      title: "易错点：k 与 b 的意义辨析",
      contentMd:
        "（约 6 分钟）\n\n**易错 1** 把 $b$ 当成「直线斜率」。错误表现：认为 $y=2x-3$ 中 $-3$ 越大直线越陡。错因：混淆 $k$ 与 $b$ 的作用。正确做法：$k$ 决定陡缓与方向，$b$ 只决定与 $y$ 轴交点的位置。\n\n**易错 2** 忽略 $k\\neq 0$ 的限制。错误表现：把 $y=3$ 也当作一次函数。错因：只看到「$x$ 的一次式」这一形式。正确做法：一次函数要求自变量 $x$ 的次数为 1 且系数不为 0。\n\n**易错 3** 用错增减性方向。错误表现：看到 $k=-2$ 仍写「$y$ 随 $x$ 增大而增大」。错因：把 $k$ 的符号与斜率正负记反。正确做法：$k>0$ 递增、$k<0$ 递减，可代入两个点验证。\n\n易混对比：\n- $k$：影响直线的倾斜方向与陡缓；\n- $b$：影响直线与 $y$ 轴交点的纵坐标。",
    },
    {
      type: "EXERCISE",
      title: "课堂练习：判断、求式与图象",
      contentMd:
        "（约 7 分钟）\n\n1. （基础）对于函数 $y=-4x+7$，说明 $y$ 随 $x$ 的变化情况，并写出与 $y$ 轴交点的坐标。\n2. （基础）已知一次函数图象经过点 $(2,6)$ 且与 $y=3x-2$ 平行，求它的表达式。\n3. （提高）已知 $y=kx+b$ 的图象经过第一、二、四象限，判断 $k$、$b$ 的符号。\n4. （拓展）某出租车起步价 10 元（含 3 千米），超出部分每千米 2 元，写出车费 $y$（元）与里程 $x$（千米，$x>3$）的函数关系。\n\n### 参考答案\n\n1. $k=-4<0$，所以 $y$ 随 $x$ 增大而减小；令 $x=0$ 得 $y=7$，交点为 $(0,7)$。\n2. 平行则 $k=3$，设 $y=3x+b$，代入 $(2,6)$ 得 $6=6+b$，所以 $b=0$，即 $y=3x$。\n3. 图象过第一、二、四象限：由过第二象限知 $b>0$，由向右下倾斜知 $k<0$。\n4. 超出部分为 $x-3$ 千米，故 $y=10+2(x-3)=2x+4$（$x>3$）。",
    },
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

// 浙江卷配图默认 mock —— 一个最小可渲染的三角形（含一个直角的视觉示意）。
const DEFAULT_PAPER_FIGURE = {
  figure: {
    kind: "GEOMETRY",
    points: [
      { id: "A", x: 20, y: 80 },
      { id: "B", x: 80, y: 80 },
      { id: "C", x: 20, y: 20 },
    ],
    segments: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "A" },
    ],
    circles: [],
    labels: [{ text: "8", x: 50, y: 84 }],
  },
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
  if (sys.includes("几何配图助手")) return DEFAULT_PAPER_FIGURE;
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
