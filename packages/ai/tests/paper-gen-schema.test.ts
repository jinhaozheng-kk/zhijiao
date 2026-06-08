import { describe, it, expect } from "vitest";
import { PaperGenerationOutputSchema, PaperGenerationInputSchema } from "../src/schemas.js";

const valid = {
  title: "一次函数练习卷",
  items: [{
    stemMd: "求 y=2x+1 当 x=3 时的值", type: "CALCULATION", answerMd: "7",
    solutionMd: "代入 x=3：y=2*3+1=7", difficulty: 2, cognitiveLevel: "APPLY",
    points: 5, knowledgePointHints: ["一次函数求值"],
  }],
};

describe("PaperGenerationOutputSchema", () => {
  it("接受合法输出", () => { expect(() => PaperGenerationOutputSchema.parse(valid)).not.toThrow(); });
  it("拒非法 cognitiveLevel", () => {
    expect(() => PaperGenerationOutputSchema.parse({ ...valid, items: [{ ...valid.items[0], cognitiveLevel: "X" }] })).toThrow();
  });
  it("拒空 items", () => {
    expect(() => PaperGenerationOutputSchema.parse({ ...valid, items: [] })).toThrow();
  });
});

describe("PaperGenerationInputSchema", () => {
  it("PaperGenerationInputSchema 接受 sections，拒绝空 sections", () => {
    expect(() =>
      PaperGenerationInputSchema.parse({
        subject: "数学", gradeLevel: "G8", kpNames: ["x"],
        sections: [{ type: "SINGLE_CHOICE", count: 3 }],
        difficultyRange: [1, 5],
      }),
    ).not.toThrow();
    expect(() =>
      PaperGenerationInputSchema.parse({
        subject: "数学", gradeLevel: "G8", kpNames: ["x"],
        sections: [], difficultyRange: [1, 5],
      }),
    ).toThrow();
  });
});

describe("PaperGenerationInputSchema 中考扩展", () => {
  it("接受可选 styleRules 与 slotHints", () => {
    const parsed = PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G9", kpNames: ["一次函数"],
      sections: [{ type: "SINGLE_CHOICE", count: 2 }],
      difficultyRange: [1, 3],
      styleRules: ["题干使用正式考试语言"],
      slotHints: [{ type: "SINGLE_CHOICE", intent: "考查基础概念", constraints: ["只有一个正确答案"] }],
    });
    expect(parsed.styleRules).toEqual(["题干使用正式考试语言"]);
    expect(parsed.slotHints?.[0]?.intent).toBe("考查基础概念");
  });

  it("不传扩展字段仍向后兼容", () => {
    const parsed = PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G9", kpNames: ["一次函数"],
      sections: [{ type: "FILL_BLANK", count: 1 }], difficultyRange: [2, 4],
    });
    expect(parsed.styleRules).toBeUndefined();
  });
});
