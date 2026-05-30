import type { KpNode } from "./types.js";

// 高中数学（样本骨架）。领域按《普通高中数学课标 2017/2020》主线，不沿用义教四领域。
export const seniorMath: KpNode = {
  code: "math-sh",
  name: "高中",
  children: [
    {
      code: "math-sh-fn",
      name: "函数",
      children: [
        {
          code: "math-sh-fn-quadratic",
          name: "二次函数",
          children: [
            // 注意 alias 用消歧词，避免与未来初中"函数"撞全局 alias 唯一（validateKpData 会拦）
            { code: "math-sh-fn-quadratic-graph", name: "二次函数图象", difficulty: 3, aliases: ["二次函数图象"] },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：几何与代数 / 概率与统计 / 数学建模与探究。
  ],
};
