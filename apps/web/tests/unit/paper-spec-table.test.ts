import { describe, it, expect } from "vitest";
import { buildSpecTable } from "@/server/lib/paper-spec-table";

const items = [
  { kpHints: ["一次函数"], cognitiveLevel: "APPLY", type: "CALCULATION", difficulty: 2, points: 5 },
  { kpHints: ["一次函数"], cognitiveLevel: "APPLY", type: "CALCULATION", difficulty: 2, points: 5 },
  { kpHints: ["不等式"], cognitiveLevel: "UNDERSTAND", type: "SINGLE_CHOICE", difficulty: 1, points: 4 },
];

describe("buildSpecTable", () => {
  it("按 KP×能力×题型×难度 聚合题数与分值，并给总分", () => {
    const t = buildSpecTable(items as never);
    expect(t.totalPoints).toBe(14);
    expect(t.totalCount).toBe(3);
    const cell = t.rows.find((r) => r.kp === "一次函数" && r.cognitiveLevel === "APPLY" && r.type === "CALCULATION" && r.difficulty === 2);
    expect(cell?.count).toBe(2);
    expect(cell?.points).toBe(10);
  });
  it("空卷返回零", () => {
    const t = buildSpecTable([]);
    expect(t.totalCount).toBe(0); expect(t.totalPoints).toBe(0); expect(t.rows).toEqual([]);
  });
});
