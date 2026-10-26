import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveGeometryFigure, extractVertexNames } from "@/lib/paper-figure-derive";
import { PaperFigure } from "@/components/paper-figure";

describe("extractVertexNames（几何题干 → 顶点字母）", () => {
  it("Rt△ABC / △ABC / 三角形ABC 都能识别", () => {
    expect(extractVertexNames("在 Rt△ABC 中，∠C=90°，AC=3，BC=4。")).toEqual(["A", "B", "C"]);
    expect(extractVertexNames("已知△ABC 中 AB=AC。")).toEqual(["A", "B", "C"]);
    expect(extractVertexNames("三角形ABC 的周长为 12。")).toEqual(["A", "B", "C"]);
  });

  it("四边形 ABCD 识别 4 个顶点", () => {
    expect(extractVertexNames("四边形ABCD 是平行四边形。")).toEqual(["A", "B", "C", "D"]);
  });

  it("点 A、B、C 列举识别", () => {
    expect(extractVertexNames("已知点A、B、C在同一条直线上。")).toEqual(["A", "B", "C"]);
  });

  it("没有顶点字母返回空数组", () => {
    expect(extractVertexNames("一个直角三角形的两条直角边分别为 3 和 4。")).toEqual([]);
  });
});

describe("deriveGeometryFigure（几何示意图兜底）", () => {
  it("有顶点字母时生成闭合多边形 + 可渲染", () => {
    const figure = deriveGeometryFigure("在 Rt△ABC 中，∠C=90°，AC=3，BC=4，求 AB。")!;
    expect(figure.kind).toBe("GEOMETRY");
    if (figure.kind === "GEOMETRY") {
      expect(figure.points.map((p) => p.id)).toEqual(["A", "B", "C"]);
      expect(figure.segments).toHaveLength(3);
    }
    const html = renderToStaticMarkup(<PaperFigure figure={figure} />);
    expect(html).toContain("<line");
    expect(html).not.toContain("NaN");
  });

  it("四边形 ABCD 生成闭合四边形", () => {
    const figure = deriveGeometryFigure("四边形ABCD 中，AB∥CD，AD=BC。")!;
    if (figure.kind === "GEOMETRY") {
      expect(figure.points).toHaveLength(4);
      expect(figure.segments).toHaveLength(4);
    }
  });

  it("非几何题或认不出顶点返回 null", () => {
    expect(deriveGeometryFigure("解方程 3x-7=11。")).toBeNull();
    expect(deriveGeometryFigure("直角三角形两条直角边为 3 和 4，求斜边。")).toBeNull();
  });
});
