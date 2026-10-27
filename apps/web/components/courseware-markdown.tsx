/**
 * 课件正文 Markdown 渲染（预览页 / 打印页共用）。
 *
 * 为什么不引完整 Markdown 库：AI 课件正文的语法集是受控的（小标题、列表、加粗、
 * 行内代码、简单表格 + LaTeX），这里用几十行纯函数解析到 React 节点即可，
 * 不拼接 HTML、不引入 `dangerouslySetInnerHTML`（唯一的受控 HTML 来自 KaTeX）。
 * 与 `math-segments` / `MathText` 同款思路：只处理真实出现过的语法，未知语法按
 * 普通文本原样显示，绝不吞内容。
 */
import { MathText } from "./math-text";

export type CoursewareBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string }
  | { kind: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const UL_RE = /^\s*[-*+]\s+(.+)$/;
const OL_RE = /^\s*(\d+)[.)、．]\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const HR_RE = /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitTableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

export function parseCoursewareMarkdown(source: string): CoursewareBlock[] {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: CoursewareBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "hr" });
      continue;
    }

    // 表格：`| a | b |` 起始，第二行是 `|---|---|` 分隔行才算表格。
    if (TABLE_ROW_RE.test(line) && TABLE_SEP_RE.test(lines[i + 1] ?? "")) {
      flushParagraph();
      const header = splitTableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? "")) {
        rows.push(splitTableCells(lines[i]!));
        i++;
      }
      i--; // 外层 for 会再 +1
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      flushParagraph();
      const ordered = OL_RE.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const match = ordered ? current.match(OL_RE) : current.match(UL_RE);
        if (!match) break;
        items.push((ordered ? match[2] : match[1])!.trim());
        i++;
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote) {
      flushParagraph();
      const quoteLines: string[] = [quote[1] ?? ""];
      while (i + 1 < lines.length) {
        const next = (lines[i + 1] ?? "").match(QUOTE_RE);
        if (!next) break;
        quoteLines.push(next[1] ?? "");
        i++;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n").trim() });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

/** 行内渲染：**加粗** / `代码` / $公式$（公式交给 MathText）。 */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(INLINE_RE).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-slate-900">
          <MathText text={part.slice(2, -2)} />
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <MathText key={key} text={part} />;
  });
}

function headingClass(level: number): string {
  if (level <= 2) return "mt-5 text-lg font-semibold text-slate-900";
  if (level === 3) return "mt-4 text-base font-semibold text-slate-900";
  return "mt-3 text-sm font-semibold text-slate-800";
}

export function CoursewareMarkdown({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const blocks = parseCoursewareMarkdown(text ?? "");
  return (
    <div className={`text-sm leading-7 text-slate-900 ${className ?? ""}`} data-testid="courseware-markdown">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = (block.level <= 2 ? "h3" : block.level === 3 ? "h4" : "h5") as "h3" | "h4" | "h5";
            return (
              <Tag key={index} className={headingClass(block.level)}>
                {renderInline(block.text, `h${index}`)}
              </Tag>
            );
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={index}
                className={`my-2 space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, `l${index}-${itemIndex}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={index} className="my-2 border-l-4 border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                {renderInline(block.text, `q${index}`)}
              </blockquote>
            );
          case "table":
            return (
              <div key={index} className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex} className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold">
                          {renderInline(cell, `th${index}-${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="border border-slate-200 px-2 py-1 align-top">
                            {renderInline(cell, `td${index}-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={index} className="my-4 border-slate-200" />;
          case "paragraph":
          default:
            return (
              <p key={index} className="my-2 whitespace-pre-wrap">
                {renderInline(block.text, `p${index}`)}
              </p>
            );
        }
      })}
    </div>
  );
}
