import { describe, it, expect } from "vitest";
import { reviewPaperSlot, reviewAssembledPaper, type ReviewableItem } from "@/server/lib/paper-review";
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
  answerMd: "A",
  solutionMd: "把四个选项分别代入 y=2x 检验，只有 (0,0) 满足方程，因此选 A。",
  difficulty: 2, points: 3,
};

describe("reviewPaperSlot 结构校验", () => {
  it("合格选择题无 issue", () => {
    expect(reviewPaperSlot(choiceSlot, okChoice)).toEqual([]);
  });
  it("答案字母超出选项数（4 选项答 E）→ WARNING CHOICE_ANSWER_OUT_OF_RANGE", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "E" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "CHOICE_ANSWER_OUT_OF_RANGE" }));
  });
  it("正常答案（带正文 'A. (0,0)'）不触发越界", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "A. (0,0)" });
    expect(issues.some((i) => i.code === "CHOICE_ANSWER_OUT_OF_RANGE")).toBe(false);
  });
  it("无前导字母的答案（纯公式/见解析）保守不触发", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "$y=2x$" });
    expect(issues.some((i) => i.code === "CHOICE_ANSWER_OUT_OF_RANGE")).toBe(false);
  });
  it("题型不匹配 → BLOCKER TYPE_MISMATCH", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, type: "FILL_BLANK" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "TYPE_MISMATCH" }));
  });
  it("选择题选项 ≠ 4 → BLOCKER CHOICE_OPTION_COUNT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, options: ["A", "B", "C"] });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "CHOICE_OPTION_COUNT" }));
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
  it("题干超长 → WARNING STEM_TOO_LONG（601 触发，600 不触发）", () => {
    const long = reviewPaperSlot(choiceSlot, { ...okChoice, stemMd: "甲".repeat(601) });
    expect(long).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "STEM_TOO_LONG" }));
    const boundary = reviewPaperSlot(choiceSlot, { ...okChoice, stemMd: "甲".repeat(600) });
    expect(boundary.some((i) => i.code === "STEM_TOO_LONG")).toBe(false);
  });
});

describe("内容质量门（v4 配套）", () => {
  const essaySlot: BlueprintSlot = {
    ...choiceSlot,
    questionType: "ESSAY",
    sectionType: "解答题",
    points: 10,
    answerAreaHint: "large",
  };
  function essayItem(overrides: Partial<ReviewableItem> = {}): ReviewableItem {
    return {
      stemMd: "某商店销售一种商品，售价 20 元，成本 15 元，求利润函数并求利润最大时的销量。",
      type: "ESSAY",
      answerMd: "利润函数 P=-x^2+30x-200，x=15 时最大 25 元。",
      solutionMd:
        "设销量为 x 件，则利润 P=(20-15)x-200/x...（完整分步：先设未知数，再列函数关系式，接着配方求最值，最后检验并作答）。",
      rubricMd: "设未知数 2 分；列函数关系式 3 分；配方求最值 3 分；检验作答 2 分。",
      difficulty: 3,
      points: 10,
      ...overrides,
    };
  }

  it("解答题解析过短（<120 字）→ BLOCKER SHORT_SOLUTION（触发修复轮）", () => {
    const issues = reviewPaperSlot(essaySlot, essayItem({ solutionMd: "设销量 x，解得最大值 25。" }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "SHORT_SOLUTION" }));
  });

  it("解答题解析偏短（120–180 字）→ WARNING SHORT_SOLUTION_WARN", () => {
    const issues = reviewPaperSlot(essaySlot, essayItem({ solutionMd: "步".repeat(140) }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "SHORT_SOLUTION_WARN" }));
  });

  it("解答题缺评分标准 → WARNING MISSING_RUBRIC", () => {
    const issues = reviewPaperSlot(essaySlot, essayItem({ rubricMd: undefined }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "MISSING_RUBRIC" }));
  });

  it("选择题重复选项 → WARNING CHOICE_OPTIONS_DUPLICATE", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, options: ["(0,0)", "(0,0)", "(1,3)", "(2,1)"] });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "CHOICE_OPTIONS_DUPLICATE" }));
  });

  it("选择题「以上都对」类凑数选项 → WARNING CHOICE_ALL_OF_ABOVE", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, options: ["(0,0)", "(1,1)", "(1,3)", "以上都对"] });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "CHOICE_ALL_OF_ABOVE" }));
  });

  it("选择题答案不是字母（如「见解析」）→ WARNING CHOICE_ANSWER_NOT_LETTER", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "见解析" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "CHOICE_ANSWER_NOT_LETTER" }));
  });

  it("题干过短（<12 字）→ WARNING STEM_TOO_SHORT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, stemMd: "求 x。" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "STEM_TOO_SHORT" }));
  });
});

describe("reviewAssembledPaper 聚合", () => {
  it("汇总多个 slot 的 issue，并保留各自 slotQuestionNo", () => {
    const dirtySlot = { ...choiceSlot, questionNo: 7 };
    const issues = reviewAssembledPaper([
      { slot: choiceSlot, item: okChoice },                                   // 干净
      { slot: dirtySlot, item: { ...okChoice, answerMd: "  " } },             // EMPTY_ANSWER
    ]);
    expect(issues.some((i) => i.code === "EMPTY_ANSWER" && i.slotQuestionNo === 7)).toBe(true);
    // 干净 slot 不产生 issue：所有 issue 都应来自 questionNo 7
    expect(issues.every((i) => i.slotQuestionNo === 7)).toBe(true);
  });
});
