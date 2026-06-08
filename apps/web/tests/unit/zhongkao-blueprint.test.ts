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

import { buildZhongkaoMathBlueprint } from "@/lib/zhongkao-blueprint";

const KPS = [
  { id: "kp1", name: "一次函数" },
  { id: "kp2", name: "二元一次方程组" },
  { id: "kp3", name: "几何图形" },
];

describe("buildZhongkaoMathBlueprint", () => {
  it("展开 24 个连续题位，题号 1..24", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    expect(bp.slots).toHaveLength(24);
    expect(bp.slots.map((s) => s.questionNo)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
  });

  it("末尾 2 道解答题标 isCapstone，作答区 extraLarge", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    const capstones = bp.slots.filter((s) => s.isCapstone);
    expect(capstones).toHaveLength(2);
    expect(capstones.map((s) => s.questionNo)).toEqual([23, 24]);
    expect(capstones.every((s) => s.answerAreaHint === "extraLarge")).toBe(true);
  });

  it("KP 轮转分配，每个 slot 至少一个 KP，且全部 KP 都被覆盖", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    expect(bp.slots.every((s) => s.kpIds.length >= 1)).toBe(true);
    const covered = new Set(bp.slots.flatMap((s) => s.kpIds));
    expect(covered).toEqual(new Set(["kp1", "kp2", "kp3"]));
  });

  it("少于 3 个 KP 视为专题卷 isTopical=true", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC",
      kps: [{ id: "kp1", name: "一次函数" }],
    });
    expect(bp.isTopical).toBe(true);
  });

  it("客观题 answerAreaHint=short；普通解答题按分值在 medium/large 间", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    const choice = bp.slots.find((s) => s.questionType === "SINGLE_CHOICE")!;
    expect(choice.answerAreaHint).toBe("short");
    const essayMid = bp.slots.find((s) => s.questionType === "ESSAY" && !s.isCapstone && s.points >= 10)!;
    expect(essayMid.answerAreaHint).toBe("large");
  });

  it("空 KP 抛错（非法输入）", () => {
    expect(() =>
      buildZhongkaoMathBlueprint({
        gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: [],
      }),
    ).toThrow(/至少一个知识点|kp/i);
  });
});
