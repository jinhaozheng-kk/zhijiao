import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperSpecTable } from "@/app/teacher/papers/paper-detail-components";

describe("paper UI components", () => {
  it("renders the spec table rows and totals", () => {
    const html = renderToStaticMarkup(
      <PaperSpecTable
        specTable={{
          rows: [
            {
              kp: "一次函数",
              cognitiveLevel: "APPLY",
              type: "CALCULATION",
              difficulty: 3,
              count: 2,
              points: 10,
            },
          ],
          totalCount: 2,
          totalPoints: 10,
        }}
      />,
    );

    expect(html).toContain("双向细目表");
    expect(html).toContain("一次函数");
    expect(html).toContain("应用");
    expect(html).toContain("计算题");
    expect(html).toContain("合计 2 题");
    expect(html).toContain("10 分");
  });
});
