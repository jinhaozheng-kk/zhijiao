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
