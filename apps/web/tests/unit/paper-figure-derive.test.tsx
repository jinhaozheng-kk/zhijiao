import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveFunctionFigure, deriveAxesForExpression, extractFunctionExpression } from "@/lib/paper-figure-derive";
import { PaperFigure } from "@/components/paper-figure";

describe("extractFunctionExpression（题干 → 解析式）", () => {
  it("从 LaTeX 二次函数题干提取表达式", () => {
    expect(extractFunctionExpression("已知二次函数 $y = x^2 - 4x + 3$，求顶点坐标。")).toBe("y=x^2-4x+3");
  });

  it("支持上标 ² 与一次函数", () => {
    expect(extractFunctionExpression("二次函数 y = x² + 2x - 1 的图像")).toBe("y=x^2+2x-1");
    expect(extractFunctionExpression("一次函数 y=2x+1 的图像经过哪个点")).toBe("y=2x+1");
  });

  it("非函数题干返回 null（不硬配图）", () => {
    expect(extractFunctionExpression("某商品原价 120 元，打 8 折后是多少元？")).toBeNull();
    expect(extractFunctionExpression("下列哪个选项是一次方程 3x-7=11 的解？")).toBeNull();
  });

  it("不支持的表达式（sin 等）返回 null，交给渲染层忽略", () => {
    expect(extractFunctionExpression("函数 y=sin(x) 的图像")).toBeNull();
  });
});

describe("deriveAxesForExpression（坐标轴范围推导）", () => {
  it("抛物线范围包含原点、跨度合理", () => {
    const axes = deriveAxesForExpression("y=x^2-4x+3")!;
    expect(axes.xMin).toBeLessThanOrEqual(0);
    expect(axes.xMax).toBeGreaterThanOrEqual(0);
    expect(axes.yMin).toBeLessThanOrEqual(0);
    expect(axes.yMax).toBeGreaterThan(0);
    expect(axes.xMax - axes.xMin).toBeLessThanOrEqual(30);
  });

  it("非法表达式返回 null", () => {
    expect(deriveAxesForExpression("y=sin(x)")).toBeNull();
  });
});

describe("deriveFunctionFigure（题干直接生成函数图象）", () => {
  it("生成 COORDINATE + curves，并能渲染出 polyline", () => {
    const figure = deriveFunctionFigure("已知二次函数 $y = x^2 - 4x + 3$，求其顶点坐标。")!;
    expect(figure.kind).toBe("COORDINATE");
    if (figure.kind === "COORDINATE") {
      expect(figure.curves).toHaveLength(1);
      expect(figure.curves[0]!.expression).toBe("y=x^2-4x+3");
    }
    const html = renderToStaticMarkup(<PaperFigure figure={figure} />);
    expect(html).toContain("<polyline");
    expect(html).not.toContain("NaN");
  });

  it("一次函数 y=2x+1 也能生成", () => {
    const figure = deriveFunctionFigure("一次函数 y=2x+1 的图像经过哪个点？")!;
    expect(figure.kind).toBe("COORDINATE");
  });

  it("纯文字应用题不生成图", () => {
    expect(deriveFunctionFigure("小明买 3 个苹果，每个 2 元，一共多少钱？")).toBeNull();
  });
});
