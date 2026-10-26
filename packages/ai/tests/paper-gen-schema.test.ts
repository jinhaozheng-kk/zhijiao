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

describe("PaperGenItemSchema 真实模型脏数据归一化", () => {
  const base = {
    type: "SINGLE_CHOICE",
    answerMd: "B",
    difficulty: 2,
    cognitiveLevel: "UNDERSTAND",
    points: 3,
    knowledgePointHints: ["一次方程应用题"],
  };

  it("options 用字面量 \\n 拼接 → 切成 4 个选项", () => {
    const parsed = PaperGenerationOutputSchema.parse({
      title: "卷",
      items: [{ ...base, stemMd: "每本 4 元，共 32 元，买了几本？", options: "A. 6\\nB. 8\\nC. 9\\nD. 10", solutionMd: "4x=32，x=8。" }],
    });
    expect(parsed.items[0]!.options).toEqual(["6", "8", "9", "10"]);
  });

  it("题干末尾重复抄了一遍选项 → 自动剥掉（避免与 options 重复渲染）", () => {
    const parsed = PaperGenerationOutputSchema.parse({
      title: "卷",
      items: [{
        ...base,
        stemMd: "每本 4 元，共 32 元，买了几本？\\nA. 6\\nB. 8\\nC. 9\\nD. 10",
        options: "A. 6\\nB. 8\\nC. 9\\nD. 10",
        solutionMd: "4x=32，x=8。",
      }],
    });
    expect(parsed.items[0]!.stemMd).toBe("每本 4 元，共 32 元，买了几本？");
  });

  it("题干用双反斜杠 + n（\\\\n）拼接的重复选项块也能剥掉", () => {
    const parsed = PaperGenerationOutputSchema.parse({
      title: "卷",
      items: [{
        ...base,
        // 源码里 "\\\\n" = 两个字符反斜杠 + n（真实模型的双重转义）
        stemMd: "每本 4 元，共 32 元，买了几本？\\\\nA. 6\\\\nB. 8\\\\nC. 9\\\\nD. 10",
        options: "A. 6\\nB. 8\\nC. 9\\nD. 10",
        solutionMd: "4x=32，x=8。",
      }],
    });
    expect(parsed.items[0]!.stemMd).toBe("每本 4 元，共 32 元，买了几本？");
    expect(parsed.items[0]!.options).toEqual(["6", "8", "9", "10"]);
  });

  it("answer/solution 里的字面量 \\n 还原成真换行", () => {
    const parsed = PaperGenerationOutputSchema.parse({
      title: "卷",
      items: [{ ...base, stemMd: "解方程 2x=6", options: undefined, solutionMd: "第一步：2x=6\\n第二步：x=3" }],
    });
    expect(parsed.items[0]!.solutionMd).toBe("第一步：2x=6\n第二步：x=3");
  });

  it("LaTeX 命令不被误还原", () => {
    const parsed = PaperGenerationOutputSchema.parse({
      title: "卷",
      items: [{ ...base, stemMd: "若 $a\\neq b$，求值", options: undefined, solutionMd: "因为 $a\\neq b$。" }],
    });
    expect(parsed.items[0]!.stemMd).toContain("\\neq");
    expect(parsed.items[0]!.solutionMd).toContain("\\neq");
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
