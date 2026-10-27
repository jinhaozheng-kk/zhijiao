import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AiRouter } from "../src/index.js";
import { AnswerVerifyResultSchema, AnswerVerifyOutputSchema } from "../src/schemas.js";

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

defineSuite();
function defineSuite() {
  describe("答案正确性抽检：verdict 归一化", () => {
    it("英文大小写 / 中文 / 同义词都归一化到 CORRECT/WRONG/UNCERTAIN", () => {
      expect(AnswerVerifyResultSchema.parse({ questionNo: 1, verdict: "correct" }).verdict).toBe("CORRECT");
      expect(AnswerVerifyResultSchema.parse({ questionNo: 2, verdict: "Wrong" }).verdict).toBe("WRONG");
      expect(AnswerVerifyResultSchema.parse({ questionNo: 3, verdict: "正确" }).verdict).toBe("CORRECT");
      expect(AnswerVerifyResultSchema.parse({ questionNo: 4, verdict: "错误" }).verdict).toBe("WRONG");
      expect(AnswerVerifyResultSchema.parse({ questionNo: 5, verdict: "不确定" }).verdict).toBe("UNCERTAIN");
      expect(AnswerVerifyResultSchema.parse({ questionNo: 6, verdict: "???" }).verdict).toBe("UNCERTAIN");
    });

    it("reason 缺失时默认为空串；questionNo 非法时报错", () => {
      const out = AnswerVerifyOutputSchema.parse({ results: [{ questionNo: 1, verdict: "CORRECT" }] });
      expect(out.results[0]!.reason).toBe("");
      expect(() => AnswerVerifyOutputSchema.parse({ results: [] })).toThrow();
      expect(() => AnswerVerifyOutputSchema.parse({ results: [{ questionNo: 0, verdict: "CORRECT" }] })).toThrow();
    });
  });

  describe("AiRouter.verifyPaperAnswers", () => {
    it("用第二个模型(qwen3.8-max, thinking off)判卷，题目一一转写进 prompt", async () => {
      const seen: Array<{ model: string; content: string; enableThinking?: boolean }> = [];
      const router = new AiRouter({
        prisma: fakePrisma(),
        adapter: {
          name: "answer-spy",
          async call(req) {
            seen.push({
              model: req.model,
              content: req.messages.find((m) => m.role === "user")?.content ?? "",
              enableThinking: req.enableThinking,
            });
            return {
              content: JSON.stringify({
                results: [
                  { questionNo: 1, verdict: "CORRECT", reason: "答案与解析一致" },
                  { questionNo: 2, verdict: "WRONG", reason: "解析与答案矛盾" },
                ],
              }),
              model: req.model,
            };
          },
        },
      });

      const out = await router.verifyPaperAnswers({
        items: [
          { questionNo: 1, stemMd: "求 1+1", answerMd: "2", solutionMd: "1+1=2" },
          { questionNo: 2, stemMd: "求 2×3", answerMd: "5", solutionMd: "2×3=6，所以答案是 6" },
        ],
      });

      expect(seen[0]?.model).toBe("qwen3.8-max");
      expect(seen[0]?.enableThinking).toBe(false);
      expect(seen[0]?.content).toContain("【第1题】");
      expect(seen[0]?.content).toContain("【第2题】");
      expect(out.results.map((r) => r.verdict)).toEqual(["CORRECT", "WRONG"]);
      expect(out.results[1]?.reason).toContain("解析与答案矛盾");
    });
  });

  describe("AiRouter.fixPaperAnswers", () => {
    it("用 qwen3.8-max 修复判错题，返回 answerMd/solutionMd 且不改题干", async () => {
      const seen: Array<{ model: string; content: string }> = [];
      const router = new AiRouter({
        prisma: fakePrisma(),
        adapter: {
          name: "fix-spy",
          async call(req) {
            seen.push({
              model: req.model,
              content: req.messages.find((m) => m.role === "user")?.content ?? "",
            });
            return {
              content: JSON.stringify({
                fixes: [
                  {
                    questionNo: 2,
                    answerMd: "6",
                    solutionMd: "2×3=6，所以答案是 6。（分步：先算乘法，再得结论。）",
                    note: "原答案 5 系算错",
                  },
                ],
              }),
              model: req.model,
            };
          },
        },
      });

      const out = await router.fixPaperAnswers({
        items: [
          {
            questionNo: 2,
            stemMd: "求 2×3",
            answerMd: "5",
            solutionMd: "2×3=6，所以答案是 6",
            issue: "答案与解析矛盾",
          },
        ],
      });

      expect(seen[0]?.model).toBe("qwen3.8-max");
      expect(seen[0]?.content).toContain("【第2题】");
      expect(seen[0]?.content).toContain("答案与解析矛盾");
      expect(out.fixes[0]).toMatchObject({ questionNo: 2, answerMd: "6" });
      expect(out.fixes[0]?.solutionMd.length).toBeGreaterThan(10);
    });
  });
}
