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
