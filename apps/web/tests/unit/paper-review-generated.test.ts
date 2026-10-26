import { describe, it, expect } from "vitest";
import {
  reviewGeneratedPaper,
  type GeneratedReviewItem,
} from "@/server/lib/paper-review";

function item(over: Partial<GeneratedReviewItem> = {}): GeneratedReviewItem {
  return {
    questionNo: 1,
    source: "AI",
    stemMd: "小明买了 3 个苹果共花 12 元，每个苹果多少元？",
    type: "ESSAY",
    options: undefined,
    answerMd: "4 元",
    solutionMd:
      "设每个苹果的价格为 x 元。根据题意，3 个苹果共花 12 元，可列方程 3x = 12。" +
      "方程两边同时除以 3，得 x = 4。因此每个苹果 4 元。回代检验：3 × 4 = 12，与题设相符，答案成立。" +
      "书写时注意设未知数要带单位，解方程后必须回代检验，避免出现漏写单位或算错除法的失分。" +
      "此外还要注意题目问的是单价而不是总价，答题末尾应写完整答句。",
    difficulty: 2,
    points: 8,
    ...over,
  };
}

const codes = (issues: ReturnType<typeof reviewGeneratedPaper>) => issues.map((i) => i.code);
const blockers = (issues: ReturnType<typeof reviewGeneratedPaper>) =>
  issues.filter((i) => i.severity === "BLOCKER");

describe("reviewGeneratedPaper（通用出卷审题）", () => {
  it("合规的解答题：无 issue", () => {
    expect(reviewGeneratedPaper([item()])).toEqual([]);
  });

  it("AI 选择题完全没有选项 → BLOCKER", () => {
    const issues = reviewGeneratedPaper([
      item({ type: "SINGLE_CHOICE", options: undefined, answerMd: "A" }),
    ]);
    expect(codes(issues)).toContain("CHOICE_OPTIONS_MISSING");
    expect(blockers(issues).length).toBe(1);
  });

  it("题库选择题缺选项 → 仅 WARNING（数据留白，不阻断生成）", () => {
    const issues = reviewGeneratedPaper([
      item({ source: "BANK", type: "SINGLE_CHOICE", options: undefined, answerMd: "A" }),
    ]);
    expect(codes(issues)).toContain("BANK_CHOICE_OPTIONS_MISSING");
    expect(blockers(issues)).toHaveLength(0);
  });

  it("选择题选项数不为 4 → WARNING", () => {
    const issues = reviewGeneratedPaper([
      item({ type: "SINGLE_CHOICE", options: ["1", "2"], answerMd: "A" }),
    ]);
    expect(codes(issues)).toContain("CHOICE_OPTION_COUNT");
    expect(blockers(issues)).toHaveLength(0);
  });

  it("答案字母越界 → WARNING", () => {
    const issues = reviewGeneratedPaper([
      item({ type: "SINGLE_CHOICE", options: ["1", "2", "3", "4"], answerMd: "E" }),
    ]);
    expect(codes(issues)).toContain("CHOICE_ANSWER_OUT_OF_RANGE");
  });

  it("空答案 / 空解析 → BLOCKER", () => {
    const issues = reviewGeneratedPaper([
      item({ questionNo: 1, answerMd: "  " }),
      item({ questionNo: 2, solutionMd: "" }),
    ]);
    expect(blockers(issues).map((i) => i.code)).toEqual(["EMPTY_ANSWER", "MISSING_SOLUTION"]);
  });

  it("填空题带选项 → WARNING", () => {
    const issues = reviewGeneratedPaper([
      item({ type: "FILL_BLANK", options: ["A", "B"], answerMd: "1" }),
    ]);
    expect(codes(issues)).toContain("FILL_HAS_OPTIONS");
  });

  it("解析过短 → WARNING（按题型阈值）", () => {
    const issues = reviewGeneratedPaper([item({ solutionMd: "x=4" })]);
    expect(codes(issues)).toContain("SOLUTION_TOO_SHORT");
    expect(blockers(issues)).toHaveLength(0);
  });

  it("依赖插图「如图」→ WARNING", () => {
    const issues = reviewGeneratedPaper([
      item({ stemMd: "如图，在三角形 ABC 中，∠A=60°，求∠B。" }),
    ]);
    expect(codes(issues)).toContain("FIGURE_DEPENDENT");
  });

  it("命中禁用措辞 → BLOCKER", () => {
    const issues = reviewGeneratedPaper([item({ solutionMd: "本题属于必考题型，务必掌握。" })]);
    expect(codes(issues)).toContain("FORBIDDEN_PHRASE");
    expect(blockers(issues).length).toBeGreaterThan(0);
  });

  it("仅改数字的近似重复题 → 后一题 WARNING DUPLICATE_TEMPLATE", () => {
    const stem = "小明买了 3 个苹果共花 12 元，每个苹果多少元？";
    const dupStem = "小明买了 5 个苹果共花 20 元，每个苹果多少元？";
    const issues = reviewGeneratedPaper([
      item({ questionNo: 1, stemMd: stem }),
      item({ questionNo: 2, stemMd: dupStem }),
    ]);
    const dup = issues.filter((i) => i.code === "DUPLICATE_TEMPLATE");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.slotQuestionNo).toBe(2);
    expect(dup[0]!.message).toContain("第 1 题");
    expect(blockers(issues)).toHaveLength(0);
  });

  it("结果按题号排序，同题号 BLOCKER 在前", () => {
    const issues = reviewGeneratedPaper([
      item({ questionNo: 3, solutionMd: "短" }),
      item({ questionNo: 1, answerMd: "" }),
    ]);
    expect(issues[0]!.slotQuestionNo).toBe(1);
    expect(issues[0]!.severity).toBe("BLOCKER");
  });
});
