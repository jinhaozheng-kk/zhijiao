import type { KpNode } from "./types.js";

// 初中数学（首发做全做透）。现有 4 KP 实迁：code 保持不变，仅纳入新树层级。
export const juniorMath: KpNode = {
  code: "math-jh",
  name: "初中",
  children: [
    {
      code: "math-jh-alg",
      name: "数与代数",
      children: [
        {
          code: "math-g8-linear-eq", // 实迁：原顶层"一次方程"，code 不变，改作主题
          name: "一次方程",
          children: [
            {
              code: "math-g8-linear-eq-solve", // 实迁，code 不变
              name: "一次方程求解",
              difficulty: 2,
              aliases: ["一元一次方程", "linear equation", "一次方程"],
            },
            {
              code: "math-g8-linear-eq-apply", // 实迁，code 不变
              name: "一次方程应用题",
              difficulty: 3,
              aliases: ["一次方程应用题", "linear equation word problem"],
            },
            {
              code: "math-g8-linear-eq-system", // 实迁，code 不变
              name: "二元一次方程组",
              difficulty: 3,
              aliases: ["二元一次方程组", "system of equations", "方程组"],
            },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：图形与几何 / 统计与概率 / 综合与实践 等领域与主题。
  ],
};
