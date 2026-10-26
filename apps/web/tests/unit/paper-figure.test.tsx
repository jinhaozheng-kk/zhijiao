import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FigureSpec } from "@zhijiao/ai";
import { PaperFigure, figureForPosition } from "@/components/paper-figure";

const geometry: FigureSpec = {
  kind: "GEOMETRY",
  points: [
    { id: "A", x: 20, y: 80 },
    { id: "B", x: 80, y: 80 },
    { id: "C", x: 50, y: 20 },
  ],
  segments: [
    { from: "A", to: "B" },
    { from: "B", to: "C", dashed: true },
    { from: "A", to: "Z" }, // 不存在的点：应被静默跳过
  ],
  circles: [{ cx: 50, cy: 60, r: 12 }],
  labels: [{ text: "60°", x: 45, y: 40 }],
};

const coordinate: FigureSpec = {
  kind: "COORDINATE",
  axes: { xMin: -2, xMax: 6, yMin: -2, yMax: 8 },
  points: [
    { id: "A", x: -1, y: 3 },
    { id: "B", x: 3, y: -1 },
  ],
  segments: [{ from: "A", to: "B" }],
  circles: [],
  labels: [{ text: "y=2x+1", x: 1, y: 6 }],
  curves: [],
};

describe("PaperFigure 渲染器", () => {
  it("平面几何图：输出 SVG、点名、标注与虚线", () => {
    const html = renderToStaticMarkup(<PaperFigure figure={geometry} />);
    expect(html).toContain("<svg");
    expect(html).toContain('data-testid="paper-figure"');
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).toContain(">C<");
    expect(html).toContain("60°");
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("<circle");
  });

  it("坐标系图：画坐标轴、刻度与数据点，且不输出 NaN", () => {
    const html = renderToStaticMarkup(<PaperFigure figure={coordinate} />);
    expect(html).toContain("<svg");
    expect(html).toContain("y=2x+1");
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).not.toContain("NaN");
    expect(html).toContain("marker-end"); // 坐标轴箭头
  });

  it("函数图象：按表达式取样渲染成 polyline（抛物线）", () => {
    const withCurve: FigureSpec = {
      kind: "COORDINATE",
      axes: { xMin: -3, xMax: 3, yMin: -2, yMax: 9 },
      points: [],
      segments: [],
      circles: [],
      labels: [],
      curves: [{ expression: "y=x^2-2x+3" }],
    };
    const html = renderToStaticMarkup(<PaperFigure figure={withCurve} />);
    expect(html).toContain("<polyline");
    expect(html).toContain('fill="none"');
    expect(html).not.toContain("NaN");
    expect((html.match(/<polyline/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("非法函数表达式不会渲染曲线、也不会抛错", () => {
    const bad: FigureSpec = {
      kind: "COORDINATE",
      axes: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
      points: [],
      segments: [],
      circles: [],
      labels: [],
      curves: [{ expression: "sin(x)" }],
    };
    const html = renderToStaticMarkup(<PaperFigure figure={bad} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain("NaN");
  });

  it("模型给的越界坐标(>100)会自动缩放进画布，不产生 NaN", () => {
    const wild: FigureSpec = {
      kind: "GEOMETRY",
      points: [
        { id: "A", x: -30, y: 240 },
        { id: "B", x: 380, y: 240 },
        { id: "C", x: 175, y: -90 },
      ],
      segments: [{ from: "A", to: "B" }],
      circles: [],
      labels: [],
    };
    const html = renderToStaticMarkup(<PaperFigure figure={wild} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("figure 为 null/undefined 时不渲染任何内容", () => {
    expect(renderToStaticMarkup(<PaperFigure figure={null} />)).toBe("");
    expect(renderToStaticMarkup(<PaperFigure figure={undefined} />)).toBe("");
  });
});

describe("figureForPosition（从 paramsJson 取图）", () => {
  it("按题号取 FigureSpec，缺失返回 null", () => {
    const params = { figures: { 3: geometry, 7: coordinate } };
    expect(figureForPosition(params, 3)).toEqual(geometry);
    expect(figureForPosition(params, 7)).toEqual(coordinate);
    expect(figureForPosition(params, 1)).toBeNull();
  });

  it("paramsJson 结构异常时不抛错", () => {
    expect(figureForPosition(null, 1)).toBeNull();
    expect(figureForPosition({ figures: "oops" }, 1)).toBeNull();
    expect(figureForPosition({ figures: { 1: "x" } }, 1)).toBeNull();
  });
});
