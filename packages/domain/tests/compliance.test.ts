import { describe, expect, it } from "vitest";
import { FORBIDDEN_PHRASES, findForbidden, FORECAST_APPROVED_LANGUAGE } from "../src/compliance.js";

describe("Compliance", () => {
  it("forbids 押中原题", () => {
    expect(FORBIDDEN_PHRASES).toContain("押中原题");
  });

  it("forbids 提分保证", () => {
    expect(FORBIDDEN_PHRASES).toContain("保证提分");
  });

  it("findForbidden returns matched phrases in text", () => {
    const text = "我们押中原题的概率达 100%，保证提分。";
    const matches = findForbidden(text);
    expect(matches.sort()).toEqual(["保证提分", "押中原题"].sort());
  });

  it("findForbidden returns empty for compliant text", () => {
    expect(findForbidden("本次趋势研判覆盖主要考点方向。")).toEqual([]);
  });

  it("approved forecast language list includes 趋势研判 and 考点方向分析", () => {
    expect(FORECAST_APPROVED_LANGUAGE).toContain("趋势研判");
    expect(FORECAST_APPROVED_LANGUAGE).toContain("考点方向分析");
  });
});

describe("findForbidden 中考相关黑词", () => {
  it.each(["押题", "必考", "预测题", "原题还原", "考前答案"])(
    "命中 %s",
    (phrase) => {
      expect(findForbidden(`这是${phrase}范例`)).toContain(phrase);
    },
  );
  it("正常题干不误伤", () => {
    expect(findForbidden("求一次函数 y=2x+1 的图象与 x 轴交点。")).toEqual([]);
  });
});
