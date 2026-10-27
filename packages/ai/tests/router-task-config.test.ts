import { describe, it, expect, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AiRouter, type AdapterRequest } from "../src/index.js";

// 只覆盖 AiRouter 用到的三处 prisma 调用：promptTemplate.findUnique / create、modelCall.create。
function fakePrisma(): PrismaClient {
  return {
    promptTemplate: {
      findUnique: async () => null,
      create: async () => ({ id: "pt-1" }),
    },
    modelCall: {
      create: async () => ({ id: "mc-1" }),
    },
  } as unknown as PrismaClient;
}

const VALID_PAPER_ITEM = {
  stemMd: "已知一次函数 y=2x+1，当 x=1 时 y 的值为（ ）",
  type: "SINGLE_CHOICE",
  options: ["1", "2", "3", "4"],
  answerMd: "C",
  solutionMd: "代入 x=1 得 y=2×1+1=3。",
  difficulty: 2,
  cognitiveLevel: "UNDERSTAND",
  points: 3,
  knowledgePointHints: ["一次函数"],
};

function paperInput() {
  return {
    subject: "数学",
    gradeLevel: "G8",
    kpNames: ["一次函数"],
    sections: [{ type: "SINGLE_CHOICE" as const, count: 1 }],
    difficultyRange: [1, 3] as [number, number],
    textbookVersion: "GENERIC",
  };
}

const ENV_KEYS = [
  "AI_MODEL_PAPER_GEN",
  "AI_THINKING_PAPER_GEN",
  "AI_TIMEOUT_MS_PAPER_GEN",
  "AI_FALLBACK_MODEL_PAPER_GEN",
] as const;
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("JSON 解析失败 → 备用模型兜底", () => {
  it("qwen-max 返回坏 JSON 时，第二次重试自动切到 fallbackModel（qwen3.8-max）", async () => {
    const seen: string[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "fallback-spy",
        async call(req) {
          seen.push(req.model);
          if (req.model === "qwen-max") {
            return { content: '{"title": "卷", "items": [', model: req.model }; // 截断的坏 JSON
          }
          return {
            content: JSON.stringify({ title: "卷", items: [VALID_PAPER_ITEM] }),
            model: req.model,
          };
        },
      },
    });

    const out = await router.generatePaper(paperInput());
    expect(out.items).toHaveLength(1);
    expect(seen).toEqual(["qwen-max", "qwen3.8-max"]);
  });

  it("AI_FALLBACK_MODEL_<KIND> 可覆盖备用模型", async () => {
    process.env.AI_FALLBACK_MODEL_PAPER_GEN = "qwen3.7-max";
    const seen: string[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "fallback-env-spy",
        async call(req) {
          seen.push(req.model);
          if (req.model === "qwen-max") {
            return { content: "not json at all", model: req.model };
          }
          return {
            content: JSON.stringify({ title: "卷", items: [VALID_PAPER_ITEM] }),
            model: req.model,
          };
        },
      },
    });

    await router.generatePaper(paperInput());
    expect(seen).toEqual(["qwen-max", "qwen3.7-max"]);
  });

  it("无 fallback 配置的任务（tutor）重试仍用同一个模型", async () => {
    const seen: string[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "no-fallback-spy",
        async call(req) {
          seen.push(req.model);
          if (seen.length === 1) return { content: "bad json", model: req.model };
          return {
            content: JSON.stringify({
              restatement: "题意",
              knowledgePoints: ["一次函数"],
              steps: ["步骤"],
              pitfalls: [],
              finalAnswer: "x=1",
            }),
            model: req.model,
          };
        },
      },
    });

    await router.tutor({ questionStem: "解方程 x+1=2", studentGrade: "G8" });
    expect(seen).toEqual(["qwen-plus", "qwen-plus"]);
  });
});

describe("AiRouter → adapter 请求参数", () => {
  it("默认：生成类任务带上 enableThinking=false + 600s 超时 + 默认模型", async () => {
    const seen: AdapterRequest[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "spy",
        async call(req) {
          seen.push(req);
          return {
            content: JSON.stringify({ title: "卷", items: [VALID_PAPER_ITEM] }),
            model: req.model,
            tokensIn: 1,
            tokensOut: 1,
          };
        },
      },
    });

    const out = await router.generatePaper(paperInput());
    expect(out.items).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.model).toBe("qwen-max");
    expect(seen[0]?.enableThinking).toBe(false);
    expect(seen[0]?.timeoutMs).toBe(600_000);
  });

  it("env 覆盖模型/思考/超时会真正传到 adapter", async () => {
    process.env.AI_MODEL_PAPER_GEN = "qwen3.8-max";
    process.env.AI_THINKING_PAPER_GEN = "on";
    process.env.AI_TIMEOUT_MS_PAPER_GEN = "9000";

    const seen: AdapterRequest[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "spy",
        async call(req) {
          seen.push(req);
          return {
            content: JSON.stringify({ title: "卷", items: [VALID_PAPER_ITEM] }),
            model: req.model,
          };
        },
      },
    });

    await router.generatePaper(paperInput());
    expect(seen[0]?.model).toBe("qwen3.8-max");
    expect(seen[0]?.enableThinking).toBe(true);
    expect(seen[0]?.timeoutMs).toBe(9000);
  });

  it("modelOverride 优先级高于 env", async () => {
    process.env.AI_MODEL_PAPER_GEN = "qwen3.8-max";
    const seen: AdapterRequest[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      modelOverride: "ab-test-model",
      adapter: {
        name: "spy",
        async call(req) {
          seen.push(req);
          return {
            content: JSON.stringify({ title: "卷", items: [VALID_PAPER_ITEM] }),
            model: req.model,
          };
        },
      },
    });
    await router.generatePaper(paperInput());
    expect(seen[0]?.model).toBe("ab-test-model");
  });

  it("非生成类任务（tutor）不带 thinking/超时字段，避免影响存量行为", async () => {
    const seen: AdapterRequest[] = [];
    const router = new AiRouter({
      prisma: fakePrisma(),
      adapter: {
        name: "spy",
        async call(req) {
          seen.push(req);
          return {
            content: JSON.stringify({
              restatement: "题意",
              knowledgePoints: ["一次函数"],
              steps: ["步骤"],
              pitfalls: [],
              finalAnswer: "x=1",
            }),
            model: req.model,
          };
        },
      },
    });
    await router.tutor({ questionStem: "解方程 x+1=2", studentGrade: "G8" });
    expect(seen[0]?.model).toBe("qwen-plus");
    expect("enableThinking" in (seen[0] ?? {})).toBe(false);
    expect("timeoutMs" in (seen[0] ?? {})).toBe(false);
  });
});
