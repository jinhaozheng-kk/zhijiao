import { describe, it, expect } from "vitest";
import {
  FigureSpecSchema,
  FigureGenerationOutputSchema,
} from "../src/schemas.js";

const geometry = {
  kind: "GEOMETRY",
  points: [
    { id: "A", x: 20, y: 80 },
    { id: "B", x: 80, y: 80 },
    { id: "C", x: 50, y: 20 },
  ],
  segments: [
    { from: "A", to: "B" },
    { from: "B", to: "C", dashed: true },
  ],
  circles: [{ cx: 50, cy: 50, r: 25 }],
  labels: [{ text: "8", x: 50, y: 84 }],
};

const coordinate = {
  kind: "COORDINATE",
  axes: { xMin: -2, xMax: 6, yMin: -2, yMax: 8 },
  points: [
    { id: "A", x: -1, y: 3 },
    { id: "B", x: 3, y: -1 },
  ],
  segments: [{ from: "A", to: "B" }],
  circles: [],
  labels: [{ text: "y=2x+1", x: 1, y: 6 }],
};

describe("FigureSpecSchema（配图 DSL）", () => {
  it("接受平面几何图与坐标系图", () => {
    expect(() => FigureSpecSchema.parse(geometry)).not.toThrow();
    expect(() => FigureSpecSchema.parse(coordinate)).not.toThrow();
  });

  it("拒绝非法点 id（必须字母开头）", () => {
    expect(() =>
      FigureSpecSchema.parse({ ...geometry, points: [{ id: "1", x: 1, y: 1 }, { id: "B", x: 2, y: 2 }] }),
    ).toThrow();
  });

  it("拒绝坐标轴范围倒挂", () => {
    expect(() =>
      FigureSpecSchema.parse({ ...coordinate, axes: { xMin: 5, xMax: -5, yMin: 0, yMax: 5 } }),
    ).toThrow();
  });

  it("拒绝 GEOMETRY 少于 2 个点 / 半径非正", () => {
    expect(() => FigureSpecSchema.parse({ ...geometry, points: [{ id: "A", x: 0, y: 0 }] })).toThrow();
    expect(() =>
      FigureSpecSchema.parse({ ...geometry, circles: [{ cx: 50, cy: 50, r: 0 }] }),
    ).toThrow();
  });

  it("未知 kind 被拒（防止模型输出任意结构）", () => {
    expect(() => FigureSpecSchema.parse({ kind: "SVG", svg: "<svg/>" })).toThrow();
  });

  it("FigureGenerationOutput 接受 figure:null（本题不需要配图）", () => {
    const out = FigureGenerationOutputSchema.parse({ figure: null });
    expect(out.figure).toBeNull();
  });
});

describe("图形简写容错归一化（真实 qwen-max 输出）", () => {
  it("points:['A','B','C'] + segments:['AB','BC','CA'] + labels:['5','13'] → 补全坐标并解析线段", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "GEOMETRY",
        points: ["A", "B", "C"],
        segments: ["AB", "BC", "CA"],
        labels: ["5", "13"],
      },
    });
    expect(out.figure?.kind).toBe("GEOMETRY");
    const fig = out.figure!;
    expect(fig.points).toHaveLength(3);
    expect(fig.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(fig.segments).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "A" },
    ]);
    // 简写标签没有坐标：自动摆放会误导，直接丢弃（条件题干里已有）
    expect(fig.labels).toEqual([]);
  });

  it("points 用 {A:{x,y}} 映射也能解析", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: { kind: "GEOMETRY", points: { A: { x: 10, y: 20 }, B: { x: 30, y: 40 } }, segments: [] },
    });
    expect(out.figure?.points.map((p) => p.id)).toEqual(["A", "B"]);
    expect(out.figure?.points[0]).toMatchObject({ x: 10, y: 20 });
  });

  it("线段对象别名 {start,end} / [A,B] 也能解析", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "GEOMETRY",
        points: ["A", "B", "C"],
        segments: [{ start: "A", end: "B" }, { points: ["B", "C"] }],
      },
    });
    expect(out.figure?.segments).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
  });

  it("COORDINATE 只给点名（无坐标）时降级为平面示意图，避免 NaN", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: { kind: "COORDINATE", axes: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, points: ["A", "B"] },
    });
    expect(out.figure?.kind).toBe("GEOMETRY");
    expect(out.figure?.points.every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it("COORDINATE 缺 axes 时用默认范围兜底", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "COORDINATE",
        points: [
          { id: "A", x: 1, y: 2 },
          { id: "B", x: 3, y: 1 },
        ],
      },
    });
    expect(out.figure?.kind).toBe("COORDINATE");
    if (out.figure?.kind === "COORDINATE") {
      expect(out.figure.axes).toEqual({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 });
    }
  });

  it("完全无法识别（无点）时仍然报错，不静默吞掉", () => {
    expect(() => FigureGenerationOutputSchema.parse({ figure: { kind: "GEOMETRY", points: [] } })).toThrow();
  });

  it("函数图象简写：curves:['y=x^2-2x+3'] → 结构化 curves", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "COORDINATE",
        axes: { xMin: -3, xMax: 3, yMin: -2, yMax: 9 },
        points: [{ id: "A", x: 1, y: 2 }],
        curves: ["y=x^2-2x+3", "y=2x+1"],
      },
    });
    expect(out.figure?.kind).toBe("COORDINATE");
    if (out.figure?.kind === "COORDINATE") {
      expect(out.figure.curves.map((c) => c.expression)).toEqual(["y=x^2-2x+3", "y=2x+1"]);
    }
  });

  it("模型把解析式写进 labels（text:'y=x^2'）时自动迁到 curves", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "COORDINATE",
        axes: { xMin: -3, xMax: 3, yMin: -2, yMax: 9 },
        points: [{ id: "A", x: 0, y: 0 }],
        labels: ["y=x^2", "顶点"],
      },
    });
    if (out.figure?.kind === "COORDINATE") {
      expect(out.figure.curves.map((c) => c.expression)).toContain("y=x^2");
    }
  });

  it("curves 只保留含 x 的表达式（拒绝常数字符串）", () => {
    const out = FigureGenerationOutputSchema.parse({
      figure: {
        kind: "COORDINATE",
        axes: { xMin: -3, xMax: 3, yMin: -2, yMax: 9 },
        points: [{ id: "A", x: 0, y: 0 }],
        curves: ["y=3", "y=x"],
      },
    });
    if (out.figure?.kind === "COORDINATE") {
      expect(out.figure.curves.map((c) => c.expression)).toEqual(["y=x"]);
    }
  });
});
