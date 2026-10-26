import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MathText } from "@/components/math-text";

describe("MathText（KaTeX 服务端渲染）", () => {
  it("普通文本不包 KaTeX，原样输出", () => {
    const html = renderToStaticMarkup(<MathText text="小明买了 3 个苹果" />);
    expect(html).toContain("小明买了 3 个苹果");
    expect(html).not.toContain("katex");
  });

  it("行内公式渲染成 KaTeX HTML", () => {
    const html = renderToStaticMarkup(<MathText text="已知 $y=2x+1$，求值" />);
    expect(html).toContain("katex");
    expect(html).toContain("已知");
    expect(html).toContain("求值");
    // 原始 $…$ 标记不应再出现在输出里
    expect(html).not.toContain("$y=2x+1$");
  });

  it("块级公式用 display 模式渲染", () => {
    const html = renderToStaticMarkup(<MathText text="$$x^2+y^2=r^2$$" />);
    expect(html).toContain("katex-display");
  });

  it("非法公式不抛错（throwOnError:false，显示错误样式）", () => {
    expect(() => renderToStaticMarkup(<MathText text="$\\frac{1}{$" />)).not.toThrow();
    const html = renderToStaticMarkup(<MathText text="前 $\\frac{1}{$ 后" />);
    expect(html).toContain("前");
  });

  it("文本里的 HTML 标签被转义，不会变成真实元素（无 XSS）", () => {
    const html = renderToStaticMarkup(<MathText text={"<script>alert(1)</script>"} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("null/undefined 不抛错", () => {
    expect(renderToStaticMarkup(<MathText text={null} />)).toContain('data-testid="math-text"');
    expect(renderToStaticMarkup(<MathText text={undefined} />)).toContain('data-testid="math-text"');
  });
});
