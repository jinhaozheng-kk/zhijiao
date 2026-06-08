import { describe, it, expect } from "vitest";
import {
  ZHONGKAO_TEMPLATE_ID,
  ZHONGKAO_GENERIC_TEMPLATE,
} from "@/lib/zhongkao-blueprint";

describe("ZHONGKAO_GENERIC_TEMPLATE 常量", () => {
  it("模板 id 固定为 v1 标识", () => {
    expect(ZHONGKAO_TEMPLATE_ID).toBe("JUNIOR_MATH_ZHONGKAO_GENERIC_V1");
  });

  it("默认满分 120 分：选择 10×3 + 填空 6×3 + 解答(6+6+8+8+10+10+12+12)", () => {
    let total = 0;
    for (const sec of ZHONGKAO_GENERIC_TEMPLATE) {
      total += sec.pointsLadder.reduce((a, b) => a + b, 0);
    }
    expect(total).toBe(120);
  });

  it("三大题顺序：选择题→填空题→解答题，题型映射到既有 QuestionType", () => {
    expect(ZHONGKAO_GENERIC_TEMPLATE.map((s) => s.questionType)).toEqual([
      "SINGLE_CHOICE",
      "FILL_BLANK",
      "ESSAY",
    ]);
  });
});
