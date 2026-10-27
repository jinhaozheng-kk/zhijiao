import { describe, it, expect } from "vitest";
import {
  LessonPlanGenerationInputSchema,
  LessonPlanGenerationOutputSchema,
} from "../src/schemas.js";

const sec = (type: string) => ({ type, title: type, contentMd: "内容" });
const five = ["INTRO", "EXPLANATION", "EXAMPLE", "PITFALL", "EXERCISE"].map(sec);

describe("LessonPlanGenerationOutputSchema", () => {
  it("五段齐全过", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "课件", sections: five }),
    ).not.toThrow();
  });
  it("缺段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "x", sections: five.slice(0, 4) }),
    ).toThrow();
  });
  it("重复段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({
        title: "x",
        sections: [
          sec("INTRO"),
          sec("INTRO"),
          sec("EXPLANATION"),
          sec("EXAMPLE"),
          sec("PITFALL"),
        ],
      }),
    ).toThrow();
  });
  it("六段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "x", sections: [...five, sec("INTRO")] }),
    ).toThrow();
  });

  it("字面量 \\n / <br> 还原成真换行（与试卷同款兜底）", () => {
    const out = LessonPlanGenerationOutputSchema.parse({
      title: " 课件 ",
      sections: [
        { type: "INTRO", title: "导入", contentMd: "第一行\\n第二行<br>第三行" },
        ...five.slice(1),
      ],
    });
    expect(out.title).toBe("课件");
    expect(out.sections[0]!.contentMd).toBe("第一行\n第二行\n第三行");
  });

  it("LaTeX 命令不被误还原（\\neq 仍保留）", () => {
    const out = LessonPlanGenerationOutputSchema.parse({
      title: "x",
      sections: [
        { type: "INTRO", title: "导入", contentMd: "$k \\neq 0$ 且 $a \\nabla b$" },
        ...five.slice(1),
      ],
    });
    expect(out.sections[0]!.contentMd).toContain("\\neq");
    expect(out.sections[0]!.contentMd).toContain("\\nabla");
  });
});

describe("LessonPlanGenerationInputSchema", () => {
  it("接受可选 qualityInstructions（修复轮指令）", () => {
    const parsed = LessonPlanGenerationInputSchema.parse({
      gradeLevel: "G8",
      kpNames: ["一次函数"],
      qualityInstructions: ["扩写讲解结构段"],
    });
    expect(parsed.qualityInstructions).toEqual(["扩写讲解结构段"]);
  });

  it("qualityInstructions 缺省不报错", () => {
    expect(() =>
      LessonPlanGenerationInputSchema.parse({ gradeLevel: "G8", kpNames: ["一次函数"] }),
    ).not.toThrow();
  });
});
