import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCheckPanel, type AnswerCheckSummary } from "@/components/answer-check-panel";

const base: AnswerCheckSummary = {
  total: 3,
  wrong: 1,
  uncertain: 0,
  results: [
    { questionNo: 1, verdict: "CORRECT", reason: "答案与解析一致" },
    { questionNo: 2, verdict: "WRONG", reason: "解析与答案矛盾：应为 6" },
    { questionNo: 3, verdict: "CORRECT", reason: "答案与解析一致" },
  ],
};

describe("AnswerCheckPanel（AI 答案抽检结果面板）", () => {
  it("存在存疑题时展示题号、理由与红色提示", () => {
    const html = renderToStaticMarkup(<AnswerCheckPanel check={base} />);
    expect(html).toContain('data-testid="answer-check-panel"');
    expect(html).toContain("发现 1 题存疑");
    expect(html).toContain("共抽检 3 题");
    expect(html).toContain("正确 2 题");
    expect(html).toContain("第 2 题");
    expect(html).toContain("（存疑）");
    expect(html).toContain('data-testid="answer-check-link"');
    expect(html).toContain('href="#paper-item-2"');
    expect(html).toContain("解析与答案矛盾");
    expect(html).toContain('data-testid="answer-check-wrong"');
  });

  it("全部正确时显示「未发现明显错误」", () => {
    const html = renderToStaticMarkup(
      <AnswerCheckPanel
        check={{ total: 2, wrong: 0, uncertain: 0, results: [
          { questionNo: 1, verdict: "CORRECT", reason: "" },
          { questionNo: 2, verdict: "CORRECT", reason: "" },
        ] }}
      />,
    );
    expect(html).toContain("未发现明显错误");
    expect(html).not.toContain("（存疑）");
  });

  it("无法判定题单独展示", () => {
    const html = renderToStaticMarkup(
      <AnswerCheckPanel
        check={{ total: 1, wrong: 0, uncertain: 1, results: [
          { questionNo: 4, verdict: "UNCERTAIN", reason: "条件不足" },
        ] }}
      />,
    );
    expect(html).toContain("第 4 题");
    expect(html).toContain("（无法判定）");
    expect(html).toContain('href="#paper-item-4"');
    expect(html).toContain("条件不足");
  });

  it("null / 空结果不渲染", () => {
    expect(renderToStaticMarkup(<AnswerCheckPanel check={null} />)).toBe("");
    expect(renderToStaticMarkup(<AnswerCheckPanel check={undefined} />)).toBe("");
    expect(
      renderToStaticMarkup(<AnswerCheckPanel check={{ total: 0, wrong: 0, uncertain: 0, results: [] }} />),
    ).toBe("");
  });
});
