import { describe, expect, it } from "vitest";
import {
  getCoursewareReviewWarningsFromParams,
  repairInstructionsForCourseware,
  reviewGeneratedCourseware,
  reviewCoursewareSection,
} from "@/server/lib/courseware-review";

const LONG = (marker: string, extra = "") =>
  `${marker}${"教学环节内容。".repeat(60)}${extra}`;

function sections(overrides: Record<string, Partial<{ title: string; contentMd: string; type: string }>> = {}) {
  const base = {
    INTRO: { type: "INTRO", title: "导入", contentMd: `（约 5 分钟）${LONG("情境引入。")}` },
    EXPLANATION: {
      type: "EXPLANATION",
      title: "讲解",
      contentMd: `（约 15 分钟）\n### 一、定义\n${LONG("概念。")}\n### 二、性质\n${LONG("性质。")}`,
    },
    EXAMPLE: {
      type: "EXAMPLE",
      title: "例题",
      contentMd: `${LONG("例题。")}\n解：分步解答过程。`,
    },
    PITFALL: { type: "PITFALL", title: "易错", contentMd: `${LONG("易错。")}\n错因：概念混淆。正确做法：逐项对照。` },
    EXERCISE: {
      type: "EXERCISE",
      title: "练习",
      contentMd: `${LONG("练习。")}\n### 参考答案\n1. 答案：略。`,
    },
  } as Record<string, { type: string; title: string; contentMd: string }>;
  for (const [key, value] of Object.entries(overrides)) {
    base[key] = { ...base[key]!, ...value };
  }
  return Object.values(base);
}

describe("reviewGeneratedCourseware", () => {
  it("完整五段无 blocker", () => {
    const issues = reviewGeneratedCourseware({ title: "一次函数", sections: sections() });
    expect(issues.filter((i) => i.severity === "BLOCKER")).toEqual([]);
  });

  it("过短段落 → SHORT_SECTION blocker", () => {
    const issues = reviewGeneratedCourseware({
      title: "x",
      sections: sections({ INTRO: { contentMd: "太短" } }),
    });
    const blocker = issues.find((i) => i.code === "SHORT_SECTION");
    expect(blocker?.severity).toBe("BLOCKER");
    expect(blocker?.sectionType).toBe("INTRO");
  });

  it("例题无解答 → EXAMPLE_MISSING_SOLUTION", () => {
    const issues = reviewGeneratedCourseware({
      title: "x",
      sections: sections({ EXAMPLE: { contentMd: LONG("例题只有题干。") } }),
    });
    expect(issues.some((i) => i.code === "EXAMPLE_MISSING_SOLUTION" && i.severity === "BLOCKER")).toBe(true);
  });

  it("练习无答案 → EXERCISE_MISSING_ANSWER", () => {
    const issues = reviewGeneratedCourseware({
      title: "x",
      sections: sections({ EXERCISE: { contentMd: LONG("只有练习题。") } }),
    });
    expect(issues.some((i) => i.code === "EXERCISE_MISSING_ANSWER" && i.severity === "BLOCKER")).toBe(true);
  });

  it("命中禁用措辞 → FORBIDDEN_PHRASE blocker", () => {
    const issues = reviewGeneratedCourseware({
      title: "x",
      sections: sections({ PITFALL: { contentMd: `${LONG("易错。")}错因：必考题型。` } }),
    });
    expect(issues.some((i) => i.code === "FORBIDDEN_PHRASE" && i.severity === "BLOCKER")).toBe(true);
  });

  it("偏短但在硬门以上 → SHORT_SECTION_WARN warning 不阻断", () => {
    const issues = reviewCoursewareSection(
      { type: "INTRO", title: "导入", contentMd: "（约 5 分钟）" + "情境".repeat(70) },
      5000,
    );
    expect(issues.every((i) => i.severity === "WARNING")).toBe(true);
    expect(issues.some((i) => i.code === "SHORT_SECTION_WARN")).toBe(true);
  });

  it("缺时间提示 / 整段无换行 / AI 痕迹 → warning", () => {
    const issues = reviewCoursewareSection(
      { type: "EXPLANATION", title: "讲解", contentMd: "内容".repeat(200) + "作为AI我建议" },
      5000,
    );
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["MISSING_SUBHEADINGS", "NO_LINE_BREAKS", "MISSING_TIME_HINT", "AI_ARTIFACT"]),
    );
    expect(issues.every((i) => i.severity === "WARNING")).toBe(true);
  });

  it("总字数不足 → SHORT_COURSEWARE", () => {
    // 每段刚过硬门、总字数 < 1300
    const short = [
      { type: "INTRO", title: "导入", contentMd: "导".repeat(125) },
      { type: "EXPLANATION", title: "讲解", contentMd: "讲".repeat(355) },
      { type: "EXAMPLE", title: "例题", contentMd: "例".repeat(353) + "解：" },
      { type: "PITFALL", title: "易错", contentMd: "错".repeat(205) },
      { type: "EXERCISE", title: "练习", contentMd: "练".repeat(253) + "答案" },
    ];
    const issues = reviewGeneratedCourseware({ title: "x", sections: short });
    expect(issues.some((i) => i.code === "SHORT_COURSEWARE" && i.severity === "BLOCKER")).toBe(true);
  });
});

describe("repairInstructionsForCourseware", () => {
  it("按 blocker 给出对应修订要求", () => {
    const instructions = repairInstructionsForCourseware([
      { sectionType: "EXPLANATION", severity: "BLOCKER", code: "SHORT_SECTION", message: "" },
      { sectionType: "EXAMPLE", severity: "BLOCKER", code: "EXAMPLE_MISSING_SOLUTION", message: "" },
      { sectionType: "EXERCISE", severity: "BLOCKER", code: "EXERCISE_MISSING_ANSWER", message: "" },
      { sectionType: "EXERCISE", severity: "BLOCKER", code: "SHORT_COURSEWARE", message: "" },
    ]);
    expect(instructions.join("\n")).toContain("讲解结构段必须扩写");
    expect(instructions.join("\n")).toContain("参考答案");
    expect(instructions.join("\n")).toContain("2200 字");
  });

  it("无 blocker 时返回空数组", () => {
    expect(repairInstructionsForCourseware([])).toEqual([]);
  });
});

describe("getCoursewareReviewWarningsFromParams", () => {
  it("只返回合法 WARNING，忽略坏数据", () => {
    const warnings = getCoursewareReviewWarningsFromParams({
      reviewWarnings: [
        { sectionType: "INTRO", severity: "WARNING", code: "SHORT_SECTION_WARN", message: "偏短" },
        { sectionType: "INTRO", severity: "BLOCKER", code: "SHORT_SECTION", message: "x" },
        null,
        { foo: 1 },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("SHORT_SECTION_WARN");
  });

  it("缺字段 → 空数组", () => {
    expect(getCoursewareReviewWarningsFromParams(null)).toEqual([]);
    expect(getCoursewareReviewWarningsFromParams({})).toEqual([]);
  });
});
