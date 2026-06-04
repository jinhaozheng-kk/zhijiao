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

// Plan 17: paper-gen 默认 mock —— 两道典型一次函数题。
const DEFAULT_PAPER = {
  title: "Mock 一次函数练习卷",
  items: [
    { stemMd: "求 y=2x+1 当 x=2 的值", type: "CALCULATION", answerMd: "5", solutionMd: "代入得 5", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数求值"] },
    { stemMd: "下列是一次函数的是（ ）", type: "SINGLE_CHOICE", options: ["y=x^2","y=2x+1","y=1/x","y=|x|"], answerMd: "B", solutionMd: "y=2x+1 形如 y=kx+b", difficulty: 1, cognitiveLevel: "UNDERSTAND", points: 5, knowledgePointHints: ["一次函数概念"] },
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
  if (sys.includes("练习卷命题助手")) return DEFAULT_PAPER;
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
