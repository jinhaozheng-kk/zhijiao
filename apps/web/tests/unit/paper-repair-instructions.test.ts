import { describe, it, expect } from "vitest";
import { repairInstructionsFor, downgradeSoftBlockers } from "@/server/routers/paper";
import type { PaperReviewIssue } from "@/server/lib/paper-review";

function blocker(code: string): PaperReviewIssue {
  return { slotQuestionNo: 1, severity: "BLOCKER", code, message: "x" };
}

describe("repairInstructionsFor（修复轮指令）", () => {
  it("选项格式类 blocker → 明确要求 4 项 JSON 数组、禁止字面量 \\n、题干不抄选项", () => {
    const instructions = repairInstructionsFor([blocker("CHOICE_OPTION_COUNT")]).join("\n");
    expect(instructions).toContain("恰好 4 个字符串元素");
    expect(instructions).toContain("禁止把 4 个选项拼成一个字符串");
    expect(instructions).toContain("不要把选项抄进题干");
  });

  it("缺答案/缺解析 → 分别要求补 answerMd / solutionMd", () => {
    const instructions = repairInstructionsFor([blocker("EMPTY_ANSWER"), blocker("MISSING_SOLUTION")]).join("\n");
    expect(instructions).toContain("answerMd");
    expect(instructions).toContain("solutionMd");
  });

  it("题型不一致 / 填空带选项 / 禁用措辞 → 各自有对应指令", () => {
    const codes = ["TYPE_MISMATCH", "FILL_HAS_OPTIONS", "FORBIDDEN_PHRASE"];
    const instructions = repairInstructionsFor(codes.map(blocker)).join("\n");
    expect(instructions).toContain("type 必须与本次请求的题型完全一致");
    expect(instructions).toContain("填空题不要输出 options");
    expect(instructions).toContain("禁用措辞");
  });

  it("解析过短 → 要求分步书写、≥150 字、评分标准按分值拆点", () => {
    const instructions = repairInstructionsFor([blocker("SHORT_SOLUTION")]).join("\n");
    expect(instructions).toContain("至少 4 步");
    expect(instructions).toContain("不少于 150 字");
    expect(instructions).toContain("评分点");
  });

  it("未知 blocker → 给出兜底指令（不为空）", () => {
    const instructions = repairInstructionsFor([blocker("SOMETHING_NEW")]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain("严格按 JSON schema");
  });
});

describe("downgradeSoftBlockers（软质量门降级放行）", () => {
  it("SHORT_SOLUTION 降级为 WARNING(_DOWNGRADED)，不阻断出卷", () => {
    const { hard, downgraded } = downgradeSoftBlockers([blocker("SHORT_SOLUTION")]);
    expect(hard).toHaveLength(0);
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]).toMatchObject({ severity: "WARNING", code: "SHORT_SOLUTION_DOWNGRADED" });
    expect(downgraded[0]?.message).toContain("教师核对");
  });

  it("硬缺陷（空答案 / 题型错 / 禁用措辞）仍然整卷失败", () => {
    const issues = [blocker("SHORT_SOLUTION"), blocker("EMPTY_ANSWER"), blocker("TYPE_MISMATCH"), blocker("FORBIDDEN_PHRASE")];
    const { hard, downgraded } = downgradeSoftBlockers(issues);
    expect(hard.map((i) => i.code)).toEqual(["EMPTY_ANSWER", "TYPE_MISMATCH", "FORBIDDEN_PHRASE"]);
    expect(downgraded.map((i) => i.code)).toEqual(["SHORT_SOLUTION_DOWNGRADED"]);
  });

  it("WARNING 原样忽略（不参与降级判断）", () => {
    const warning: PaperReviewIssue = { slotQuestionNo: 2, severity: "WARNING", code: "STEM_TOO_SHORT", message: "x" };
    const { hard, downgraded } = downgradeSoftBlockers([warning]);
    expect(hard).toHaveLength(0);
    expect(downgraded).toHaveLength(0);
  });
});
