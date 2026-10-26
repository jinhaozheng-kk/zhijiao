/**
 * 把「文本 + LaTeX 数学」混合串切分成片段，供 MathText 渲染。
 *
 * 支持：
 * - `$$...$$` 块级公式（display）
 * - `\[...\]` 块级公式
 * - `$...$` 行内公式
 * - `\(...\)` 行内公式
 *
 * 不是 Markdown 解析器（不走 CommonMark 全量语法），只处理试卷里最常见的数学标记，
 * 其余文本原样保留（含换行）。货币写法（如 `$5` 后面没有闭合 `$`）不会被误判。
 */

export type MathSegment =
  | { type: "text"; value: string }
  | { type: "inline" | "display"; value: string };

const MATH_PATTERN =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

export function splitMathSegments(raw: string): MathSegment[] {
  if (typeof raw !== "string" || raw.length === 0) return [{ type: "text", value: "" }];
  const text = raw.replace(/\r\n?/g, "\n");
  const segments: MathSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MATH_PATTERN.lastIndex = 0;
  while ((match = MATH_PATTERN.exec(text)) !== null) {
    const [whole, displayDollar, displayBracket, inlineParen, inlineDollar] = match;
    const latex = (displayDollar ?? displayBracket ?? inlineParen ?? inlineDollar ?? "").trim();
    if (latex.length === 0) continue; // 空公式不单独成段，让原文继续参与匹配
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const kind: "inline" | "display" =
      displayDollar !== undefined || displayBracket !== undefined ? "display" : "inline";
    segments.push({ type: kind, value: latex });
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

/**
 * 列表/摘要里的单行预览：去掉 `$…$` 等公式标记（公式渲染在列表里容易被截断显示坏），
 * 合并空白后截断。完整公式排版请用 <MathText>。
 */
export function plainPreview(raw: string, maxLength: number): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const flat = splitMathSegments(raw)
    .map((segment) => segment.value)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}
