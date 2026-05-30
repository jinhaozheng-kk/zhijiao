import type { KpNode } from "./types.js";

// 小学数学（样本骨架；用户按课标手写扩充）。
export const primaryMath: KpNode = {
  code: "math-pri",
  name: "小学",
  children: [
    {
      code: "math-pri-num",
      name: "数与代数",
      children: [
        {
          code: "math-pri-num-int",
          name: "整数运算",
          children: [
            { code: "math-pri-num-int-addsub", name: "整数加减法", difficulty: 1, aliases: ["整数加减"] },
            { code: "math-pri-num-int-muldiv", name: "整数乘除法", difficulty: 2, aliases: ["整数乘除"] },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：图形与几何 / 统计与概率 / 综合与实践。
  ],
};
