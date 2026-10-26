import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperItemOptions } from "@/components/paper-item-options";

describe("PaperItemOptions", () => {
  it("按字母序渲染选项", () => {
    const html = renderToStaticMarkup(
      <PaperItemOptions optionsJson={["5 个", "6 个", "7 个", "8 个"]} />,
    );
    // 选项文本现在包在 MathText 里（支持 $…$ 公式），字母前缀仍由列表项输出
    expect(html).toContain("A. ");
    expect(html).toContain("5 个");
    expect(html).toContain("8 个");
    expect(html).toContain('data-testid="paper-item-options"');
    expect(html).toContain('data-testid="math-text"');
  });

  it("非数组 / 空数组 / null 不渲染任何内容", () => {
    for (const value of [null, undefined, {}, [], "A. x"]) {
      const html = renderToStaticMarkup(<PaperItemOptions optionsJson={value} />);
      expect(html).toBe("");
    }
  });

  it("保留文本换行（whitespace-pre-wrap）", () => {
    const html = renderToStaticMarkup(<PaperItemOptions optionsJson={["第一行\n第二行"]} />);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("第一行");
  });

  it("自定义 className 应用到列表容器", () => {
    const html = renderToStaticMarkup(
      <PaperItemOptions optionsJson={["x"]} className="mt-1 text-sm" />,
    );
    expect(html).toContain("mt-1 text-sm");
  });
});
