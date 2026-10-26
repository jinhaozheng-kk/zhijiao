/**
 * 从题干确定性推导函数图象（不依赖模型）。
 *
 * 适用：题干里出现显式解析式（如 `已知二次函数 y = x^2 - 4x + 3`、`y=2x+1`）的题目，
 * 直接可画出图像，比让模型猜更稳。只接受受限表达式（交给 function-curve 的安全求值器），
 * 推导失败返回 null，由 AI 配图兜底。
 */
import type { FigureSpec } from "@zhijiao/ai";
import { compileFunctionExpression } from "./function-curve";

const FUNCTION_HINT_RE = /函数|抛物[线物]|双曲线|图[像象]|直线/;

/** 题干里提取形如 `y = <表达式>` 的解析式；多个取第一个。 */
export function extractFunctionExpression(stemMd: string): string | null {
  if (typeof stemMd !== "string" || !FUNCTION_HINT_RE.test(stemMd)) return null;
  // LaTeX/上标归一化
  const normalized = stemMd
    .replace(/\$/g, " ")
    .replace(/\\left|\\right|\\,|\\;|\\ /g, " ")
    .replace(/\\times|\\cdot/g, "*")
    .replace(/\\div/g, "/")
    .replace(/[²]/g, "^2")
    .replace(/[³]/g, "^3")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，。；、]/g, ",");
  const match = normalized.match(/[yY]\s*=\s*([0-9xX+\-*/^().\s]{3,60})/);
  if (!match) return null;
  // 丢掉尾部的孤立运算符/空格
  const raw = match[1]!.replace(/\s+/g, "").replace(/[+\-*/^.(]+$/, "");
  if (raw.length < 2) return null;
  const expression = `y=${raw}`;
  return compileFunctionExpression(expression) ? expression : null;
}

function niceBounds(min: number, max: number, pad: number): [number, number] {
  let lo = Math.floor(min - pad);
  let hi = Math.ceil(max + pad);
  if (lo === hi) hi = lo + 1;
  if (lo > 0) lo = 0;
  if (hi < 0) hi = 0;
  return [lo, hi];
}

/**
 * 根据解析式选一个合适的坐标轴范围：在 [-6,6] 上采样，裁掉 |y| 过大的部分，
 * 保证包含原点、范围取整、跨度不超过 30（刻度不挤）。
 */
export function deriveAxesForExpression(expression: string): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} | null {
  const fn = compileFunctionExpression(expression);
  if (!fn) return null;
  const baseMin = -6;
  const baseMax = 6;
  const step = (baseMax - baseMin) / 240;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = baseMin; x <= baseMax + 1e-9; x += step) {
    let y: number;
    try {
      y = fn(x);
    } catch {
      continue;
    }
    if (!Number.isFinite(y) || Math.abs(y) > 40) continue;
    xs.push(x);
    ys.push(y);
  }
  if (xs.length < 8) return null;
  // 用分位数裁掉极端值（抛物线两端会迅速变大）
  const sorted = [...ys].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]!;
  const yLo = q(0.02);
  const yHi = q(0.98);
  const [yMin, yMax] = niceBounds(Math.min(yLo, 0), Math.max(yHi, 0), 1);
  const [xMin, xMax] = niceBounds(Math.min(...xs), Math.max(...xs), 0.5);
  if (xMax - xMin > 30 || yMax - yMin > 30) {
    return { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };
  }
  return { xMin, xMax, yMin, yMax };
}

/** 题干 → COORDINATE 配图（含 curves），失败返回 null。 */
export function deriveFunctionFigure(stemMd: string): FigureSpec | null {
  const expression = extractFunctionExpression(stemMd);
  if (!expression) return null;
  const axes = deriveAxesForExpression(expression);
  if (!axes) return null;
  return {
    kind: "COORDINATE",
    axes,
    points: [],
    segments: [],
    circles: [],
    labels: [],
    curves: [{ expression }],
  } as FigureSpec;
}

// ── 几何示意图兜底 ─────────────────────────────────────────────────────
//
// 实测配图模型经常只给 1 个点或空图（v3 强制配图后更明显），失败重试反而拖慢出卷。
// 这里做确定性兜底：几何类题干能从文字里认出顶点（ABC/△ABC/四边形ABCD/点A、B、C），
// 就按点名顺序自动画一个闭合多边形示意图（不是严格比例，仅示意）。
// 认不出顶点就不兜底，交给 AI 配图。
const GEOMETRY_STEM_RE =
  /三角形|△|四边形|矩形|正方形|平行四边形|菱形|梯形|圆|相似|全等|勾股|折叠|旋转|轴对称|中心对称|坐标系/;

/** 从题干里抽顶点字母序列（如「△ABC」「四边形ABCD」「点A、B、C」）。 */
export function extractVertexNames(stemMd: string): string[] {
  if (typeof stemMd !== "string") return [];
  const patterns = [
    /[△](\s*[A-Z]){2,4}/g,
    /三角形\s*([A-Z]{2,4})/g,
    /四边形\s*([A-Z]{2,4})/g,
    /(?:矩形|正方形|平行四边形|菱形|梯形)\s*([A-Z]{2,4})/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(stemMd);
    if (match) {
      // 用整段匹配提取字母：/△(\s*[A-Z]){2,4}/ 的捕获组只保留最后一个字母，不能用 match[1]。
      const letters = match[0].replace(/[^A-Z]/g, "").split("");
      if (letters.length >= 3) return Array.from(new Set(letters)).slice(0, 6);
    }
  }
  // 「点A、B、C」「A，B，C 三点」这类列举
  const listed = stemMd.match(/(?:点|顶点)\s*[A-Z](?:\s*[、，,和及]\s*[A-Z]){1,5}/);
  if (listed) {
    const letters = listed[0].replace(/[^A-Z]/g, "").split("");
    if (letters.length >= 3) return Array.from(new Set(letters)).slice(0, 6);
  }
  return [];
}

function autoLayoutPolygon(ids: string[]) {
  const n = ids.length;
  if (n === 3) {
    return [
      { id: ids[0]!, x: 20, y: 78 },
      { id: ids[1]!, x: 80, y: 78 },
      { id: ids[2]!, x: 50, y: 18 },
    ];
  }
  if (n === 4) {
    return [
      { id: ids[0]!, x: 20, y: 22 },
      { id: ids[1]!, x: 80, y: 22 },
      { id: ids[2]!, x: 80, y: 78 },
      { id: ids[3]!, x: 20, y: 78 },
    ];
  }
  return ids.map((id, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
    return { id, x: 50 + 36 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
  });
}

/** 几何题干 → 闭合多边形示意图；认不出顶点或不是几何题返回 null。 */
export function deriveGeometryFigure(stemMd: string): FigureSpec | null {
  if (!GEOMETRY_STEM_RE.test(stemMd)) return null;
  const ids = extractVertexNames(stemMd);
  if (ids.length < 3) return null;
  const points = autoLayoutPolygon(ids);
  const segments = points.map((point, index) => ({
    from: point.id,
    to: points[(index + 1) % points.length]!.id,
  }));
  return {
    kind: "GEOMETRY",
    points,
    segments,
    circles: [],
    labels: [],
  } as FigureSpec;
}
