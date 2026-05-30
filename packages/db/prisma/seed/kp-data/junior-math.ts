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
        {
          code: "math-jh-alg-rational",
          name: "有理数",
          children: [
            { code: "math-jh-alg-rational-axis", name: "有理数与数轴", difficulty: 1, aliases: ["有理数", "数轴"] },
            { code: "math-jh-alg-rational-abs", name: "相反数与绝对值", difficulty: 1, aliases: ["绝对值", "相反数"] },
            { code: "math-jh-alg-rational-ops", name: "有理数的运算", difficulty: 2, aliases: ["有理数运算"] },
            { code: "math-jh-alg-rational-sci", name: "科学记数法与近似数", difficulty: 2, aliases: ["科学记数法"] },
          ],
        },
        {
          code: "math-jh-alg-real",
          name: "实数",
          children: [
            { code: "math-jh-alg-real-root", name: "平方根与立方根", difficulty: 2, aliases: ["平方根", "立方根", "算术平方根"] },
            { code: "math-jh-alg-real-ops", name: "实数及其运算", difficulty: 2, aliases: ["实数"] },
            { code: "math-jh-alg-real-radical", name: "二次根式", difficulty: 3, aliases: ["二次根式"] },
          ],
        },
        {
          code: "math-jh-alg-poly",
          name: "整式与因式分解",
          children: [
            { code: "math-jh-alg-poly-addsub", name: "整式的加减", difficulty: 2, aliases: ["整式加减", "合并同类项"] },
            { code: "math-jh-alg-poly-muldiv", name: "幂的运算与整式乘除", difficulty: 3, aliases: ["整式乘法", "幂的运算", "同底数幂"] },
            { code: "math-jh-alg-poly-formula", name: "乘法公式", difficulty: 3, aliases: ["乘法公式", "完全平方公式", "平方差公式"] },
            { code: "math-jh-alg-poly-factor", name: "因式分解", difficulty: 3, aliases: ["因式分解"] },
          ],
        },
        {
          code: "math-jh-alg-fraction",
          name: "分式",
          children: [
            { code: "math-jh-alg-fraction-basic", name: "分式的概念与性质", difficulty: 2, aliases: ["分式"] },
            { code: "math-jh-alg-fraction-ops", name: "分式的运算", difficulty: 3, aliases: ["分式运算"] },
            { code: "math-jh-alg-fraction-eq", name: "分式方程", difficulty: 3, aliases: ["分式方程"] },
          ],
        },
        {
          code: "math-jh-alg-quad-eq",
          name: "一元二次方程",
          children: [
            { code: "math-jh-alg-quad-eq-solve", name: "一元二次方程的解法", difficulty: 3, aliases: ["一元二次方程", "配方法", "求根公式"] },
            { code: "math-jh-alg-quad-eq-discriminant", name: "根的判别式与根与系数关系", difficulty: 4, aliases: ["判别式", "韦达定理", "根与系数关系"] },
            { code: "math-jh-alg-quad-eq-apply", name: "一元二次方程的应用", difficulty: 4, aliases: ["一元二次方程应用"] },
          ],
        },
        {
          code: "math-jh-alg-inequality",
          name: "不等式",
          children: [
            { code: "math-jh-alg-inequality-linear", name: "一元一次不等式（组）", difficulty: 3, aliases: ["一元一次不等式", "不等式组"] },
            { code: "math-jh-alg-inequality-apply", name: "不等式的应用", difficulty: 3, aliases: ["不等式应用"] },
          ],
        },
        {
          code: "math-jh-alg-linear-fn",
          name: "一次函数",
          children: [
            { code: "math-jh-alg-linear-fn-prop", name: "一次函数的图象与性质", difficulty: 3, aliases: ["一次函数", "正比例函数"] },
            { code: "math-jh-alg-linear-fn-apply", name: "一次函数的应用", difficulty: 3, aliases: ["一次函数应用"] },
          ],
        },
        {
          code: "math-jh-alg-inverse-fn",
          name: "反比例函数",
          children: [
            { code: "math-jh-alg-inverse-fn-prop", name: "反比例函数的图象与性质", difficulty: 3, aliases: ["反比例函数"] },
            { code: "math-jh-alg-inverse-fn-apply", name: "反比例函数的应用", difficulty: 4, aliases: ["反比例函数应用"] },
          ],
        },
        {
          code: "math-jh-alg-quad-fn",
          name: "二次函数",
          children: [
            { code: "math-jh-alg-quad-fn-prop", name: "二次函数的图象与性质", difficulty: 4, aliases: ["二次函数"] },
            { code: "math-jh-alg-quad-fn-eq", name: "二次函数与一元二次方程", difficulty: 4, aliases: ["二次函数与方程"] },
            { code: "math-jh-alg-quad-fn-apply", name: "二次函数的应用", difficulty: 4, aliases: ["二次函数应用"] },
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
    {
      code: "math-jh-stat",
      name: "统计与概率",
      children: [
        {
          code: "math-jh-stat-statistics",
          name: "统计",
          children: [
            { code: "math-jh-stat-statistics-collect", name: "数据的收集整理与描述", difficulty: 2, aliases: ["统计图", "频数分布"] },
            { code: "math-jh-stat-statistics-average", name: "平均数、中位数与众数", difficulty: 2, aliases: ["平均数", "中位数", "众数"] },
            { code: "math-jh-stat-statistics-variance", name: "方差与标准差", difficulty: 3, aliases: ["方差", "标准差"] },
          ],
        },
        {
          code: "math-jh-stat-probability",
          name: "概率",
          children: [
            { code: "math-jh-stat-probability-event", name: "随机事件与概率", difficulty: 2, aliases: ["随机事件", "概率"] },
            { code: "math-jh-stat-probability-enumerate", name: "用列举法求概率", difficulty: 3, aliases: ["列举法", "树状图求概率"] },
            { code: "math-jh-stat-probability-frequency", name: "用频率估计概率", difficulty: 3, aliases: ["频率估计概率"] },
          ],
        },
      ],
    },
    {
      code: "math-jh-prac",
      name: "综合与实践",
      // 课标"综合与实践"为项目式 / 跨学科活动，极少作为单题考点 KP；此处仅保结构完整，
      // 不是 reconciler 主要匹配目标。
      children: [
        {
          code: "math-jh-prac-topic",
          name: "综合与实践",
          children: [
            { code: "math-jh-prac-modeling", name: "数学建模与探究活动", difficulty: 3, aliases: ["数学建模"] },
          ],
        },
      ],
    },
  ],
};
