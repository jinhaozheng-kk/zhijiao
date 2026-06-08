import { describe, it, expect } from "vitest";
import { coerceOptionArray, coerceStringArray } from "../src/schemas.js";

describe("coerceOptionArray", () => {
  it("数组原样保留（mock 路径 no-op），无前缀不误删", () => {
    expect(coerceOptionArray(["甲", "乙", "丙", "丁"])).toEqual(["甲", "乙", "丙", "丁"]);
    expect(coerceOptionArray(["(0,0)", "(1,1)"])).toEqual(["(0,0)", "(1,1)"]);
  });

  it("换行分隔的字符串 → 数组并剥掉 A./B. 前缀", () => {
    const s = "A. $y=2x+1$\nB. $y=x+2$\nC. $y=2x-1$\nD. $y=x-2$";
    expect(coerceOptionArray(s)).toEqual(["$y=2x+1$", "$y=x+2$", "$y=2x-1$", "$y=x-2$"]);
  });

  it("LaTeX 间距 \\\\[10pt] 分隔的字符串 → 切成 4 项（真实 qwen-max 输出）", () => {
    const s = "A. (0, 3)\\\\[10pt]B. (3, 0)\\\\[10pt]C. (0, -3)\\\\[10pt]D. (-3, 0)";
    expect(coerceOptionArray(s)).toEqual(["(0, 3)", "(3, 0)", "(0, -3)", "(-3, 0)"]);
  });

  it("单反斜杠 \\[10pt] 变体也能切", () => {
    const s = "A. 甲\\[10pt]B. 乙\\[10pt]C. 丙\\[10pt]D. 丁";
    expect(coerceOptionArray(s)).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("undefined / 非字符串非数组 原样返回（ESSAY 无 options）", () => {
    expect(coerceOptionArray(undefined)).toBeUndefined();
    expect(coerceOptionArray(null)).toBeNull();
  });
});

describe("coerceStringArray", () => {
  it("数组原样保留", () => {
    expect(coerceStringArray(["一次函数"])).toEqual(["一次函数"]);
  });
  it("单个字符串 → 单元素数组", () => {
    expect(coerceStringArray("一次函数")).toEqual(["一次函数"]);
  });
  it("顿号/逗号分隔的字符串 → 多元素", () => {
    expect(coerceStringArray("一次函数、几何图形")).toEqual(["一次函数", "几何图形"]);
    expect(coerceStringArray("一次函数, 几何图形")).toEqual(["一次函数", "几何图形"]);
  });
});
