import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CoursewareMarkdown,
  parseCoursewareMarkdown,
} from "@/components/courseware-markdown";

describe("parseCoursewareMarkdown", () => {
  it("解析小标题 / 无序列表 / 有序列表", () => {
    const blocks = parseCoursewareMarkdown(
      ["### 一、定义", "- 第一条", "- 第二条", "1. 第一步", "2. 第二步"].join("\n"),
    );
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 3, text: "一、定义" });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: false, items: ["第一条", "第二条"] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: true, items: ["第一步", "第二步"] });
  });

  it("连续普通行合并成段落并保留换行", () => {
    const blocks = parseCoursewareMarkdown("第一行\n第二行\n\n新段落");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", text: "第一行\n第二行" });
    expect(blocks[1]).toMatchObject({ kind: "paragraph", text: "新段落" });
  });

  it("解析引用、分隔线与表格", () => {
    const blocks = parseCoursewareMarkdown(
      ["> 板书要点", "---", "| 概念 | 意义 |", "| --- | --- |", "| k | 斜率 |"].join("\n"),
    );
    expect(blocks[0]).toMatchObject({ kind: "quote", text: "板书要点" });
    expect(blocks[1]).toMatchObject({ kind: "hr" });
    expect(blocks[2]).toMatchObject({
      kind: "table",
      header: ["概念", "意义"],
      rows: [["k", "斜率"]],
    });
  });

  it("空内容返回空数组，未知语法按文本保留", () => {
    expect(parseCoursewareMarkdown("")).toEqual([]);
    const blocks = parseCoursewareMarkdown("####没有空格的小标题");
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
  });
});

describe("CoursewareMarkdown", () => {
  it("渲染标题 / 列表 / 加粗", () => {
    const html = renderToStaticMarkup(
      <CoursewareMarkdown text={"### 小标题\n- **重点**内容"} />,
    );
    expect(html).toContain("<h4");
    expect(html).toContain("小标题");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).toContain("重点");
  });

  it("公式交给 KaTeX 渲染", () => {
    const html = renderToStaticMarkup(<CoursewareMarkdown text={"函数 $y=kx+b$ 的图象"} />);
    expect(html).toContain("katex");
    expect(html).not.toContain("$y=kx+b$");
  });

  it("HTML 文本被转义（不注入标签）", () => {
    const html = renderToStaticMarkup(
      <CoursewareMarkdown text={"<script>alert(1)</script> 与 <b>粗体</b>"} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("null 安全", () => {
    const html = renderToStaticMarkup(<CoursewareMarkdown text={null} />);
    expect(html).toContain("courseware-markdown");
  });
});
