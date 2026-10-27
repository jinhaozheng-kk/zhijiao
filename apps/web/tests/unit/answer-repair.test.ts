import { describe, it, expect } from "vitest";
import { runAnswerRepairLoop, mergeAnswerCheckIntoParams, type AnswerRepairItem, type AnswerVerdictItem } from "@/server/lib/answer-repair";

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

  it("maxRounds=2：第一轮修复后仍判错，会自动进行第二轮", async () => {
    let verifyRound = 0;
    const fixedNos: number[] = [];
    const result = await runAnswerRepairLoop({
      items,
      verify: async () => {
        verifyRound += 1;
        // 初始 → 第一轮修复后仍错 → 第二轮修复后全对
        return verifyRound <= 2 ? verdicts([2]) : verdicts([]);
      },
      fix: async () => [{ questionNo: 2, answerMd: `6-r${verifyRound}`, solutionMd: "2×3=6，所以答案是 6。" }],
      applyFixes: async (fixes) => {
        fixedNos.push(...fixes.map((fix) => fix.questionNo));
      },
      maxRounds: 2,
    });
    expect(result.rounds).toBe(2);
    expect(result.fixedCount).toBe(2);
    expect(result.afterWrong).toBe(0);
    expect(fixedNos).toEqual([2, 2]);
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

describe("mergeAnswerCheckIntoParams（参数合并）", () => {
  const baseParams = {
    figures: { 1: { kind: "GEOMETRY" } },
    reviewWarnings: [
      { slotQuestionNo: 9, severity: "WARNING", code: "STEM_TOO_SHORT", message: "旧警告" },
      { slotQuestionNo: 2, severity: "WARNING", code: "ANSWER_MISMATCH", message: "旧抽检警告" },
    ],
  };
  const check = {
    checkedAt: "2026-10-27T08:00:00.000Z",
    total: 2,
    wrong: 1,
    uncertain: 0,
    results: [
      { questionNo: 1, verdict: "CORRECT" as const, reason: "一致" },
      { questionNo: 2, verdict: "WRONG" as const, reason: "答案与解析矛盾" },
    ],
  };

  it("PENDING 写入状态但保留旧结果与其它字段", () => {
    const merged = mergeAnswerCheckIntoParams(baseParams, { status: "PENDING" });
    expect(merged.answerCheckStatus).toBe("PENDING");
    expect(merged.figures).toEqual(baseParams.figures);
    expect(merged.reviewWarnings).toHaveLength(1); // 旧 ANSWER_MISMATCH 被移除，其它保留
  });

  it("DONE 写入结果 + 修复统计，并把新的 WRONG 追加为 ANSWER_MISMATCH", () => {
    const merged = mergeAnswerCheckIntoParams(baseParams, {
      status: "DONE",
      check,
      repair: { beforeWrong: 3, afterWrong: 1, fixedCount: 2, rounds: 1 },
    });
    expect(merged.answerCheckStatus).toBe("DONE");
    expect(merged.answerRepair).toMatchObject({ beforeWrong: 3, fixedCount: 2 });
    const warnings = merged.reviewWarnings as Array<Record<string, unknown>>;
    expect(warnings.filter((w) => w.code === "ANSWER_MISMATCH")).toHaveLength(1);
    expect(warnings.filter((w) => w.code === "ANSWER_MISMATCH")[0]?.slotQuestionNo).toBe(2);
    expect(warnings.some((w) => w.code === "STEM_TOO_SHORT")).toBe(true);
  });

  it("FAILED 记录错误信息且不写入结果", () => {
    const merged = mergeAnswerCheckIntoParams(baseParams, { status: "FAILED", error: "AI 超时" });
    expect(merged.answerCheckStatus).toBe("FAILED");
    expect(merged.answerCheckError).toBe("AI 超时");
    expect(merged.answerCheck).toBeUndefined();
  });
});
