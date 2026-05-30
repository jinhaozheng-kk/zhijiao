import { describe, it, expect } from "vitest";
import {
  validateKpData,
  collectLeafAliases,
  flattenLeafCodes,
  type KpNode,
} from "../prisma/seed/kp-data/types.js";

const good: KpNode[] = [
  {
    code: "math-jh",
    name: "初中",
    children: [
      {
        code: "math-jh-alg",
        name: "数与代数",
        children: [
          { code: "math-jh-alg-linear-solve", name: "一次方程求解", difficulty: 2, aliases: ["一元一次方程"] },
          { code: "math-jh-alg-linear-apply", name: "一次方程应用题", difficulty: 3 },
        ],
      },
    ],
  },
];

describe("validateKpData", () => {
  it("通过结构良好的树", () => {
    expect(() => validateKpData(good)).not.toThrow();
  });

  it("重复 code 抛错（含两个 code）", () => {
    const dup: KpNode[] = [
      { code: "math-jh-alg-linear-solve", name: "A" },
      { code: "math-jh-alg-linear-solve", name: "B" },
    ];
    expect(() => validateKpData(dup)).toThrowError(/duplicate code.*math-jh-alg-linear-solve/i);
  });

  it("跨学段重复 alias 抛错（堵 alias 静默错绑雷）", () => {
    const dup: KpNode[] = [
      { code: "math-jh-fn", name: "初中函数", aliases: ["函数"] },
      { code: "math-sh-fn", name: "高中函数", aliases: ["函数"] },
    ];
    expect(() => validateKpData(dup)).toThrowError(/duplicate alias.*函数/i);
  });

  it("容器节点带 alias 抛错（alias 只挂叶子）", () => {
    const bad: KpNode[] = [
      { code: "math-jh-alg", name: "数与代数", aliases: ["代数"], children: [{ code: "x", name: "x" }] },
    ];
    expect(() => validateKpData(bad)).toThrowError(/alias on non-leaf.*math-jh-alg/i);
  });

  it("collectLeafAliases 仅收集叶子 alias", () => {
    expect(collectLeafAliases(good)).toEqual([
      { kpCode: "math-jh-alg-linear-solve", alias: "一元一次方程" },
    ]);
  });

  it("flattenLeafCodes 仅返回叶子 code", () => {
    expect(flattenLeafCodes(good).sort()).toEqual(
      ["math-jh-alg-linear-apply", "math-jh-alg-linear-solve"].sort(),
    );
  });
});
