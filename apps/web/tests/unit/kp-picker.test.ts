import { describe, it, expect } from "vitest";
import {
  domainOfCode,
  groupKpsForPicker,
  stageForGrade,
  stageOfCode,
  type KpPickerItem,
} from "@/lib/kp-picker";

const KPS: KpPickerItem[] = [
  { id: "1", name: "一次方程求解", code: "math-jh-alg-linear-eq-solve" },
  { id: "2", name: "二次函数", code: "math-jh-alg-quadratic-fn" },
  { id: "3", name: "勾股定理", code: "math-jh-geo-pythagoras" },
  { id: "4", name: "概率", code: "math-jh-stat-prob" },
  { id: "5", name: "导数", code: "math-sh-calc-derivative" },
  { id: "6", name: "分数的认识", code: "math-pri-num-fraction" },
  { id: "7", name: "一次方程应用题", code: "math-g8-linear-eq-apply" },
  { id: "8", name: "数与代数", code: "math-jh-alg" },
];

describe("stageForGrade / stageOfCode（学段识别）", () => {
  it("年级 → 学段", () => {
    expect(stageForGrade("G5")).toBe("pri");
    expect(stageForGrade("G8")).toBe("jh");
    expect(stageForGrade("G11")).toBe("sh");
    expect(stageForGrade(undefined)).toBe("jh");
  });

  it("code 前缀/年级 token → 学段", () => {
    expect(stageOfCode("math-jh-alg-x")).toBe("jh");
    expect(stageOfCode("math-pri-num-x")).toBe("pri");
    expect(stageOfCode("math-sh-calc-x")).toBe("sh");
    expect(stageOfCode("math-g8-linear-eq")).toBe("jh");
    expect(stageOfCode("demo-g8-function")).toBe("jh");
    expect(stageOfCode("misc-unknown")).toBe("other");
  });
});

describe("domainOfCode（领域分组）", () => {
  it("识别 数与代数/图形与几何/统计与概率/综合与实践", () => {
    expect(domainOfCode("math-jh-alg-x")).toBe("alg");
    expect(domainOfCode("math-jh-geo-x")).toBe("geo");
    expect(domainOfCode("math-jh-stat-x")).toBe("stat");
    expect(domainOfCode("math-jh-prac-x")).toBe("prac");
    expect(domainOfCode("math-g8-linear-eq")).toBe("other");
  });
});

describe("groupKpsForPicker（过滤 + 分组）", () => {
  it("默认只显示初中知识点，按领域分组且顺序固定（alg→geo→stat→other）", () => {
    const { groups, hiddenByStage } = groupKpsForPicker(KPS, { gradeLevel: "G8" });
    expect(groups.map((g) => g.key)).toEqual(["alg", "geo", "stat", "other"]);
    expect(groups.find((g) => g.key === "alg")!.items.map((i) => i.name)).toEqual([
      "一次方程求解",
      "二次函数",
      "数与代数",
    ]);
    // 旧种子 code（math-g8-*）无法判定领域 → 归入 other
    expect(groups.find((g) => g.key === "other")!.items.map((i) => i.name)).toEqual([
      "一次方程应用题",
    ]);
    expect(hiddenByStage).toBe(2); // 导数(高中) + 分数(小学)
  });

  it("搜索按名称/代码过滤", () => {
    const byName = groupKpsForPicker(KPS, { gradeLevel: "G8", query: "二次" });
    expect(byName.groups.flatMap((g) => g.items).map((i) => i.name)).toEqual(["二次函数"]);
    expect(byName.matchedCount).toBe(1);

    const byCode = groupKpsForPicker(KPS, { gradeLevel: "G8", query: "pythagoras" });
    expect(byCode.groups.flatMap((g) => g.items).map((i) => i.name)).toEqual(["勾股定理"]);
  });

  it("已选知识点始终保留（即使被学段过滤或搜索不匹配，方便取消选择）", () => {
    const result = groupKpsForPicker(KPS, { gradeLevel: "G8", query: "二次", selectedIds: ["5", "3"] });
    const names = result.groups.flatMap((g) => g.items).map((i) => i.name);
    expect(names).toContain("二次函数");
    expect(names).toContain("勾股定理"); // 搜索不匹配但已选 → 保留
    expect(names).toContain("导数"); // 高中但已选 → 保留
  });

  it("切换年级后只显示对应学段", () => {
    const primary = groupKpsForPicker(KPS, { gradeLevel: "G5" });
    expect(primary.groups.flatMap((g) => g.items).map((i) => i.name)).toEqual(["分数的认识"]);
    const senior = groupKpsForPicker(KPS, { gradeLevel: "G11" });
    expect(senior.groups.flatMap((g) => g.items).map((i) => i.name)).toEqual(["导数"]);
  });
});
