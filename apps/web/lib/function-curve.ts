/**
 * 函数图象取样：把受限表达式（数字 / x / + - * / ^ / 括号 / sqrt / abs）安全解析成
 * `(x) => y`，再按坐标轴范围取样成折线。
 *
 * 安全红线：**绝不使用 eval / new Function**；词法+递归下降手写解析，
 * 只允许白名单 token，非法表达式直接返回 null（渲染层跳过该曲线）。
 */

export interface CurveAxes {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

// 字符白名单只做粗筛；函数名（sqrt/abs）与未知函数（sin/log…）由解析器严格裁决。
const ALLOWED_CHARS = /^[0-9a-zA-Z+\-*/^().,\s=√]+$/;
const MAX_EXPRESSION_LENGTH = 80;

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "^" }
  | { kind: "lp" }
  | { kind: "rp" };

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const src = source.replace(/[＝]/g, "=").replace(/[−–—]/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch) || ch === ",") {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j += 1;
      const raw = src.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value) || raw === ".") return null;
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j]!)) j += 1;
      tokens.push({ kind: "ident", name: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ kind: "op", op: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lp" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rp" });
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

type Fn = (x: number) => number;

/** 表达式 → 求值函数；非法返回 null。 */
export function compileFunctionExpression(raw: string): Fn | null {
  if (typeof raw !== "string") return null;
  // 先做全角/数学符号归一化，再剥「y=」前缀（全角＝也要能识别）。
  const normalized = raw
    .replace(/[＝]/g, "=")
    .replace(/[−–—]/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();
  const trimmed = normalized.replace(/^[yY]\s*=/, "").trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EXPRESSION_LENGTH) return null;
  // 白名单校验针对去掉「y=」前缀后的表达式（前缀里的 y 不在白名单中）。
  if (!ALLOWED_CHARS.test(trimmed)) return null;
  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const eat = (): Token | undefined => tokens[pos++];

  function parseExpr(): Fn | null {
    let left: Fn | null = parseTerm();
    if (!left) return null;
    for (;;) {
      const token = peek();
      if (token?.kind === "op" && (token.op === "+" || token.op === "-")) {
        eat();
        const right = parseTerm();
        if (!right) return null;
        const l: Fn = left;
        left = token.op === "+" ? (x: number) => l(x) + right(x) : (x: number) => l(x) - right(x);
        continue;
      }
      return left;
    }
  }

  function startsPrimary(token: Token | undefined): boolean {
    if (!token) return false;
    if (token.kind === "num" || token.kind === "ident" || token.kind === "lp") return true;
    return false;
  }

  function parseTerm(): Fn | null {
    let left: Fn | null = parseUnary();
    if (!left) return null;
    for (;;) {
      const token = peek();
      if (token?.kind === "op" && (token.op === "*" || token.op === "/")) {
        eat();
        const right = parseUnary();
        if (!right) return null;
        const l: Fn = left;
        left = token.op === "*" ? (x: number) => l(x) * right(x) : (x: number) => l(x) / right(x);
        continue;
      }
      // 隐式乘法：2x / 2(x+1) / x(x-1) / 3sqrt(x)
      if (startsPrimary(token)) {
        const right = parseUnary();
        if (!right) return null;
        const l: Fn = left;
        left = (x: number) => l(x) * right(x);
        continue;
      }
      return left;
    }
  }

  function parseUnary(): Fn | null {
    const token = peek();
    if (token?.kind === "op" && (token.op === "+" || token.op === "-")) {
      eat();
      const inner = parseUnary();
      if (!inner) return null;
      return token.op === "+" ? inner : (x) => -inner(x);
    }
    return parsePower();
  }

  function parsePower(): Fn | null {
    const base = parsePrimary();
    if (!base) return null;
    const token = peek();
    if (token?.kind === "op" && token.op === "^") {
      eat();
      // 右结合：2^3^2 = 2^(3^2)
      const exponent = parseUnary();
      if (!exponent) return null;
      return (x) => Math.pow(base(x), exponent(x));
    }
    return base;
  }

  function parsePrimary(): Fn | null {
    const token = eat();
    if (!token) return null;
    if (token.kind === "num") {
      const value = token.value;
      return () => value;
    }
    if (token.kind === "lp") {
      const inner = parseExpr();
      if (!inner) return null;
      const close = eat();
      if (close?.kind !== "rp") return null;
      return inner;
    }
    if (token.kind === "ident") {
      if (token.name === "x") return (x) => x;
      if (token.name === "sqrt" || token.name === "abs") {
        const open = eat();
        if (open?.kind !== "lp") return null;
        const inner = parseExpr();
        if (!inner) return null;
        const close = eat();
        if (close?.kind !== "rp") return null;
        return token.name === "sqrt"
          ? (x) => Math.sqrt(inner(x))
          : (x) => Math.abs(inner(x));
      }
      // 其他函数（sin/cos/log…）不支持：显式拒绝，绝不静默求值
      return null;
    }
    return null;
  }

  const fn = parseExpr();
  if (!fn || pos !== tokens.length) return null;
  return fn;
}

/**
 * 按坐标轴范围取样成折线（可能多段：遇到无定义/渐近线/超范围会断开）。
 * 返回的坐标是**数据坐标**，由渲染层映射到画布。
 */
export function sampleCurve(
  expression: string,
  axes: CurveAxes,
  sampleCount = 240,
): CurvePoint[][] {
  const fn = compileFunctionExpression(expression);
  if (!fn) return [];
  const spanX = axes.xMax - axes.xMin;
  const spanY = axes.yMax - axes.yMin;
  if (!(spanX > 0) || !(spanY > 0)) return [];
  const count = Math.max(40, Math.min(600, Math.floor(sampleCount)));
  const step = spanX / count;
  const clipMargin = spanY * 20;

  const segments: CurvePoint[][] = [];
  let current: CurvePoint[] = [];
  let previous: CurvePoint | null = null;
  const flush = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
    previous = null;
  };

  for (let i = 0; i <= count; i += 1) {
    const x = axes.xMin + step * i;
    let y: number;
    try {
      y = fn(x);
    } catch {
      flush();
      continue;
    }
    if (!Number.isFinite(y) || Math.abs(y) > Math.abs(axes.yMax) + clipMargin + Math.abs(axes.yMin)) {
      flush();
      continue;
    }
    if (previous && Math.abs(y - previous.y) > spanY * 8) {
      // 渐近线附近跳变：断开，避免画出竖线
      flush();
    }
    const point: CurvePoint = { x, y };
    current.push(point);
    previous = point;
  }
  flush();
  return segments;
}
