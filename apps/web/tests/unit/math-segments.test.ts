import { describe, it, expect } from "vitest";
import { splitMathSegments, plainPreview } from "@/lib/math-segments";

describe("splitMathSegments（文本/公式切分）", () => {
  it("纯文本原样返回一段", () => {
    expect(splitMathSegments("小明买了 3 个苹果")).toEqual([
      { type: "text", value: "小明买了 3 个苹果" },
    ]);
  });

  it("行内公式 $...$ 切分", () => {
    const segments = splitMathSegments("已知函数 $y=2x+1$，求 $x=2$ 时的值。");
    expect(segments).toEqual([
      { type: "text", value: "已知函数 " },
      { type: "inline", value: "y=2x+1" },
      { type: "text", value: "，求 " },
      { type: "inline", value: "x=2" },
      { type: "text", value: " 时的值。" },
    ]);
  });

  it("块级公式 $$...$$ 与 \\[...\\] 标记为 display", () => {
    const segments = splitMathSegments("推导：$$\\frac{a}{b}$$ 以及 \\[x^2\\] 结束");
    expect(segments.filter((s) => s.type === "display").map((s) => s.value)).toEqual([
      "\\frac{a}{b}",
      "x^2",
    ]);
  });

  it("\\(...\\) 行内公式", () => {
    const segments = splitMathSegments("面积 S=\\(a^2\\) 平方厘米");
    expect(segments).toEqual([
      { type: "text", value: "面积 S=" },
      { type: "inline", value: "a^2" },
      { type: "text", value: " 平方厘米" },
    ]);
  });

  it("货币写法（未闭合的 $）不被当成公式", () => {
    const segments = splitMathSegments("售价 $5 元，另加 $3 元运费");
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("空公式 $ $ 不产生空 math 段", () => {
    const segments = splitMathSegments("a $ $ b");
    expect(segments.some((s) => s.type !== "text")).toBe(false);
  });

  it("换行保留在文本段里", () => {
    const segments = splitMathSegments("第一行\n第二行 $x$");
    expect(segments[0]).toEqual({ type: "text", value: "第一行\n第二行 " });
    expect(segments[1]).toEqual({ type: "inline", value: "x" });
  });

  it("空字符串返回一段空文本", () => {
    expect(splitMathSegments("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("plainPreview（列表摘要用纯文本预览）", () => {
  it("去掉公式标记并合并空白", () => {
    expect(plainPreview("已知函数 $y=2x+1$，求\n值。", 50)).toBe("已知函数 y=2x+1，求 值。");
  });

  it("超长截断加省略号", () => {
    const text = "一".repeat(100);
    expect(plainPreview(text, 10)).toBe("一".repeat(10) + "…");
  });

  it("空串返回空串", () => {
    expect(plainPreview("", 10)).toBe("");
  });
});
