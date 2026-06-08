import { describe, it, expect } from "vitest";
import { reviewPaperSlot, type ReviewableItem } from "@/server/lib/paper-review";
import type { BlueprintSlot } from "@/lib/zhongkao-blueprint";

const choiceSlot: BlueprintSlot = {
  questionNo: 1, sectionType: "选择题", questionType: "SINGLE_CHOICE",
  points: 3, difficulty: 2, cognitiveLevel: "UNDERSTAND",
  kpIds: ["kp1"], kpNames: ["一次函数"], intent: "x", constraints: [],
  answerAreaHint: "short", isCapstone: false,
};
const okChoice: ReviewableItem = {
  stemMd: "下列哪个点在直线 y=2x 上？", type: "SINGLE_CHOICE",
  options: ["(0,0)", "(1,1)", "(1,3)", "(2,1)"],
  answerMd: "A", solutionMd: "代入验证 (0,0) 满足。", difficulty: 2, points: 3,
};

describe("reviewPaperSlot 结构校验", () => {
  it("合格选择题无 issue", () => {
    expect(reviewPaperSlot(choiceSlot, okChoice)).toEqual([]);
  });
  it("题型不匹配 → BLOCKER TYPE_MISMATCH", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, type: "FILL_BLANK" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "TYPE_MISMATCH" }));
  });
  it("选择题选项 ≠ 4 → BLOCKER CHOICE_OPTION_COUNT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, options: ["A", "B", "C"] });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "CHOICE_OPTION_COUNT" }));
  });
  it("难度偏离 slot 超过 1 档 → BLOCKER DIFFICULTY_DRIFT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, difficulty: 5 });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "DIFFICULTY_DRIFT" }));
  });
  it("答案为空 → BLOCKER EMPTY_ANSWER", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "  " });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "EMPTY_ANSWER" }));
  });
  it("填空题输出选项 → BLOCKER FILL_HAS_OPTIONS", () => {
    const fillSlot: BlueprintSlot = { ...choiceSlot, questionType: "FILL_BLANK", sectionType: "填空题" };
    const issues = reviewPaperSlot(fillSlot, {
      stemMd: "x+1=3，则 x=____", type: "FILL_BLANK", options: ["1", "2"],
      answerMd: "2", solutionMd: "移项得 x=2。", difficulty: 2, points: 3,
    });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "FILL_HAS_OPTIONS" }));
  });
  it("禁词命中 → BLOCKER FORBIDDEN_PHRASE", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, solutionMd: "本题为今年必考押题。" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "FORBIDDEN_PHRASE" }));
  });
  it("AI 生成痕迹 → WARNING AI_ARTIFACT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, stemMd: "作为 AI，我给出：下列哪个点在 y=2x 上？" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "AI_ARTIFACT" }));
  });
  it("解答题缺解析 → BLOCKER MISSING_SOLUTION", () => {
    const essaySlot: BlueprintSlot = { ...choiceSlot, questionType: "ESSAY", sectionType: "解答题", points: 10, answerAreaHint: "large" };
    const issues = reviewPaperSlot(essaySlot, {
      stemMd: "求证 ...", type: "ESSAY", answerMd: "见解析", solutionMd: "  ", difficulty: 2, points: 10,
    });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "MISSING_SOLUTION" }));
  });
});
