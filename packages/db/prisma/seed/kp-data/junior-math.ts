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
    {
      code: "math-jh-geo",
      name: "图形与几何",
      // 对齐《义务教育数学课程标准 2022》第三学段(7–9 年级)图形与几何领域：
      // 图形的性质（相交线与平行线 / 三角形 / 四边形 / 圆）、图形的变化（变换 / 相似 / 锐角三角函数）、图形与坐标。
      children: [
        {
          code: "math-jh-geo-line",
          name: "相交线与平行线",
          children: [
            { code: "math-jh-geo-line-angle", name: "余角补角与对顶角", difficulty: 1, aliases: ["对顶角", "余角补角"] },
            { code: "math-jh-geo-line-parallel-judge", name: "平行线的判定", difficulty: 2, aliases: ["平行线判定"] },
            { code: "math-jh-geo-line-parallel-prop", name: "平行线的性质", difficulty: 2, aliases: ["平行线性质"] },
          ],
        },
        {
          code: "math-jh-geo-tri",
          name: "三角形",
          children: [
            { code: "math-jh-geo-tri-angle", name: "三角形的边角关系与内外角", difficulty: 2, aliases: ["三角形内角和", "三角形外角"] },
            { code: "math-jh-geo-tri-congruent", name: "全等三角形", difficulty: 3, aliases: ["全等三角形", "三角形全等"] },
            { code: "math-jh-geo-tri-isosceles", name: "等腰三角形与等边三角形", difficulty: 3, aliases: ["等腰三角形", "等边三角形"] },
            { code: "math-jh-geo-tri-pythagorean", name: "勾股定理", difficulty: 3, aliases: ["勾股定理", "pythagorean theorem"] },
          ],
        },
        {
          code: "math-jh-geo-quad",
          name: "四边形",
          children: [
            { code: "math-jh-geo-quad-polygon", name: "多边形及其内角和", difficulty: 2, aliases: ["多边形内角和"] },
            { code: "math-jh-geo-quad-parallelogram", name: "平行四边形", difficulty: 3, aliases: ["平行四边形"] },
            { code: "math-jh-geo-quad-special", name: "矩形菱形与正方形", difficulty: 3, aliases: ["矩形", "菱形", "正方形"] },
          ],
        },
        {
          code: "math-jh-geo-circle",
          name: "圆",
          children: [
            { code: "math-jh-geo-circle-basic", name: "圆的基本性质", difficulty: 2, aliases: ["圆的性质"] },
            { code: "math-jh-geo-circle-perp-chord", name: "垂径定理", difficulty: 3, aliases: ["垂径定理"] },
            { code: "math-jh-geo-circle-angle", name: "圆心角与圆周角", difficulty: 3, aliases: ["圆周角定理", "圆心角"] },
            { code: "math-jh-geo-circle-tangent", name: "切线的判定与性质", difficulty: 4, aliases: ["圆的切线", "切线长定理"] },
            { code: "math-jh-geo-circle-arc", name: "弧长与扇形面积", difficulty: 3, aliases: ["弧长公式", "扇形面积"] },
          ],
        },
        {
          code: "math-jh-geo-transform",
          name: "图形的变化",
          // 课标"图形的变化"含图形变换与相似（相似并回此主题，不单列）。
          children: [
            { code: "math-jh-geo-transform-axial", name: "轴对称", difficulty: 2, aliases: ["轴对称"] },
            { code: "math-jh-geo-transform-translate", name: "平移", difficulty: 2, aliases: ["平移变换"] },
            { code: "math-jh-geo-transform-rotate", name: "旋转", difficulty: 3, aliases: ["旋转变换"] },
            { code: "math-jh-geo-transform-central", name: "中心对称", difficulty: 2, aliases: ["中心对称"] },
            { code: "math-jh-geo-similar-tri", name: "相似三角形的判定与性质", difficulty: 4, aliases: ["相似三角形", "三角形相似"] },
            { code: "math-jh-geo-similar-homothetic", name: "位似", difficulty: 3, aliases: ["位似"] },
          ],
        },
        {
          code: "math-jh-geo-trig",
          name: "锐角三角函数",
          children: [
            { code: "math-jh-geo-trig-ratio", name: "锐角三角函数", difficulty: 4, aliases: ["锐角三角函数", "正弦余弦正切"] },
            { code: "math-jh-geo-trig-solve", name: "解直角三角形", difficulty: 4, aliases: ["解直角三角形"] },
          ],
        },
        {
          code: "math-jh-geo-coord",
          name: "图形与坐标",
          children: [
            { code: "math-jh-geo-coord-system", name: "平面直角坐标系", difficulty: 1, aliases: ["平面直角坐标系", "直角坐标系"] },
            { code: "math-jh-geo-coord-transform", name: "坐标与图形的变化", difficulty: 3, aliases: ["坐标与图形变化"] },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：统计与概率 / 综合与实践 等领域与主题。
  ],
};
