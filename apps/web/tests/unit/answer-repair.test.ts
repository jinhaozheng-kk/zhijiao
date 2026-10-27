import { describe, it, expect } from "vitest";
import { runAnswerRepairLoop, type AnswerRepairItem, type AnswerVerdictItem } from "@/server/lib/answer-repair";

const items: AnswerRepairItem[] = [
  { questionNo: 1, stemMd: "求 1+1", answerMd: "2", solutionMd: "1+1=2" },
  { questionNo: 2, stemMd: "求 2×3", answerMd: "5", solutionMd: "2×3=6，所以 6" },
];

function verdicts(wrongNos: number[]): AnswerVerdictItem[] {
  return items.map((item) => ({
    questionNo: item.questionNo,
    verdict: wrongNos.includes(item.questionNo) ? "WRONG" : "CORRECT",
    reason: wrongNos.includes(item.questionNo) ? "答案与解析矛盾" : "一致",
  }));
}

describe("runAnswerRepairLoop（抽检 → 修复 → 复检）", () => {
  it("没有 WRONG 时不调用修复", async () => {
    let fixCalls = 0;
    const result = await runAnswerRepairLoop({
      items,
      verify: async () => verdicts([]),
      fix: async () => {
        fixCalls++;
        return [];
      },
      applyFixes: async () => {},
    });
    expect(result).toMatchObject({ beforeWrong: 0, afterWrong: 0, fixedCount: 0, rounds: 0 });
    expect(fixCalls).toBe(0);
  });

  it("有 WRONG 时按题修复，并把判错理由传给修复器，复检后错误清零", async () => {
    const fixed: Array<{ questionNo: number; answerMd: string; solutionMd: string }> = [];
    const seenReasons: string[] = [];
    let verifyRound = 0;
    const result = await runAnswerRepairLoop({
      items,
      verify: async () => {
        verifyRound += 1;
        // 第一轮：第 2 题错；修复后第二轮：全对
        return verifyRound === 1 ? verdicts([2]) : verdicts([]);
      },
      fix: async (candidates) => {
        seenReasons.push(...candidates.map((c) => `${c.questionNo}:${c.reason}`));
        return [{ questionNo: 2, answerMd: "6", solutionMd: "2×3=6，所以答案是 6。" }];
      },
      applyFixes: async (fixes) => {
        fixed.push(...fixes);
      },
    });

    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toMatchObject({ questionNo: 2, answerMd: "6" });
    expect(seenReasons[0]).toContain("答案与解析矛盾");
    expect(result).toMatchObject({ beforeWrong: 1, afterWrong: 0, fixedCount: 1, rounds: 1 });
    expect(result.after.every((item) => item.verdict === "CORRECT")).toBe(true);
  });

  it("修复器返回空/非法 fix 时不计数、不死循环", async () => {
    const result = await runAnswerRepairLoop({
      items,
      verify: async () => verdicts([2]),
      fix: async () => [{ questionNo: 2, answerMd: "  ", solutionMd: "" }],
      applyFixes: async () => {},
    });
    expect(result.fixedCount).toBe(0);
    expect(result.rounds).toBe(1);
    expect(result.afterWrong).toBe(1);
  });

  it("maxRounds=0 时只抽检不修复", async () => {
    const result = await runAnswerRepairLoop({
      items,
      verify: async () => verdicts([2]),
      fix: async () => {
        throw new Error("should not be called");
      },
      applyFixes: async () => {},
      maxRounds: 0,
    });
    expect(result).toMatchObject({ beforeWrong: 1, fixedCount: 0, rounds: 0 });
  });
});
