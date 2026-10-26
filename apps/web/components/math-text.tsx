/**
 * 数学文本渲染：普通文字 + KaTeX 公式。
 *
 * - 服务端渲染友好：`katex.renderToString` 在 Node/浏览器都能跑，打印页与预览页共用；
 * - 安全：KaTeX `trust:false` 禁止 `\href`/`\url`/原始 HTML；普通文本用 React 子节点渲染，
 *   不拼接任何 HTML 字符串（唯一 `dangerouslySetInnerHTML` 来自 KaTeX 的受控输出）；
 * - 容错：`throwOnError:false`，非法公式显示为 KaTeX 的错误样式而不是让整页白屏；
 *   极端情况下（KaTeX 抛异常）回退成原始文本。
 */
import katex from "katex";
import { splitMathSegments } from "@/lib/math-segments";

const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: false,
  output: "html" as const,
  // 打印卷面公式不需要超出容器的自动换行
  displayMode: false,
};

function renderMath(latex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
  } catch {
    return null;
  }
}

export function MathText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const source = typeof text === "string" ? text : "";
  const segments = splitMathSegments(source);
  return (
    <span className={`whitespace-pre-wrap ${className ?? ""}`} data-testid="math-text">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.value}</span>;
        }
        const html = renderMath(segment.value, segment.type === "display");
        if (html === null) {
          // KaTeX 异常兜底：保留原文，别让公式把整段吞掉
          return <span key={index}>{`$${segment.value}$`}</span>;
        }
        return (
          <span
            key={index}
            className={segment.type === "display" ? "my-1 block overflow-x-auto" : "inline"}
            // KaTeX 输出由其自身转义；trust:false 下不接受原始 HTML/链接。
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
