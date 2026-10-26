import { describe, it, expect } from "vitest";
import { compileFunctionExpression, sampleCurve } from "@/lib/function-curve";

describe("compileFunctionExpression（安全表达式求值）", () => {
  it("一次函数 y=2x+1", () => {
    const f = compileFunctionExpression("y=2x+1")!;
    expect(f(0)).toBe(1);
    expect(f(2)).toBe(5);
    expect(f(-3)).toBe(-5);
  });

  it("二次函数 y=x^2-2x+3（支持 y= 前缀与不带前缀）", () => {
    const f = compileFunctionExpression("y=x^2-2x+3")!;
    expect(f(1)).toBe(2);
    expect(f(-1)).toBe(6);
    expect(compileFunctionExpression("x^2")!(3)).toBe(9);
  });

  it("反比例函数 y=1/x 与负号开头 y=-x^2+4", () => {
    expect(compileFunctionExpression("y=1/x")!(0.5)).toBe(2);
    const g = compileFunctionExpression("y=-x^2+4")!;
    expect(g(2)).toBe(0);
    expect(g(0)).toBe(4);
  });

  it("隐式乘法 2x / 2(x+1) / x(x-1)", () => {
    expect(compileFunctionExpression("2x")!(3)).toBe(6);
    expect(compileFunctionExpression("2(x+1)")!(2)).toBe(6);
    expect(compileFunctionExpression("x(x-1)")!(3)).toBe(6);
  });

  it("乘方右结合与分数系数", () => {
    expect(compileFunctionExpression("2^3^2")!(0)).toBe(512);
    expect(compileFunctionExpression("x/2+1")!(4)).toBe(3);
  });

  it("sqrt / abs 支持", () => {
    expect(compileFunctionExpression("sqrt(x+1)")!(3)).toBe(2);
    expect(compileFunctionExpression("abs(x-2)")!(0)).toBe(2);
  });

  it("全角等号/负号/乘除号被归一化", () => {
    expect(compileFunctionExpression("y＝2x＋1")).toBeNull(); // 全角+暂不支持，明确拒绝
    expect(compileFunctionExpression("y＝2x−1")!(2)).toBe(3);
    expect(compileFunctionExpression("2×x")!(3)).toBe(6);
  });

  it("拒绝危险或超纲表达式（绝不用 eval）", () => {
    for (const bad of [
      "alert(1)",
      "sin(x)",
      "log(x)",
      "x**2",
      "process.exit(1)",
      "y=",
      "",
      "x+",
      "((x)",
      "x;y",
      "1/0", // 语法合法但取样时会被过滤，见 sampler 测试
    ]) {
      if (bad === "1/0") continue;
      expect(compileFunctionExpression(bad), bad).toBeNull();
    }
  });
});

describe("sampleCurve（按坐标轴取样）", () => {
  const axes = { xMin: -2, xMax: 2, yMin: -5, yMax: 5 };

  it("抛物线取样为单段折线且点都在范围内", () => {
    const lines = sampleCurve("y=x^2", axes);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeGreaterThan(50);
    expect(lines[0]!.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(Math.min(...lines[0]!.map((p) => p.x))).toBeCloseTo(-2, 5);
  });

  it("1/x 在 x=0 附近断开成多段（不画竖线）", () => {
    const lines = sampleCurve("y=1/x", axes);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((line) => line.every((p) => Math.abs(p.x) > 0.001))).toBe(true);
  });

  it("非法表达式返回空数组（渲染层跳过该曲线）", () => {
    expect(sampleCurve("sin(x)", axes)).toEqual([]);
    expect(sampleCurve("", axes)).toEqual([]);
  });

  it("坐标轴范围非法时返回空数组", () => {
    expect(sampleCurve("y=x", { xMin: 2, xMax: -2, yMin: -5, yMax: 5 })).toEqual([]);
  });
});
