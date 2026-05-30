import type { KpNode } from "./types.js";

// 高中数学（《普通高中数学课程标准 2017/2020》四主线 + 预备知识），不沿用义教四领域。
// 现有 KP（二次函数图象）code 保持不变。alias 全消歧，避免与初中同名（如"概率""三角函数"）撞全局唯一。
export const seniorMath: KpNode = {
  code: "math-sh",
  name: "高中",
  children: [
    {
      code: "math-sh-prep",
      name: "预备知识",
      children: [
        {
          code: "math-sh-prep-set",
          name: "集合与常用逻辑用语",
          children: [
            { code: "math-sh-prep-set-basic", name: "集合及其运算", difficulty: 2, aliases: ["集合", "集合运算"] },
            { code: "math-sh-prep-set-logic", name: "常用逻辑用语", difficulty: 2, aliases: ["充分必要条件", "全称量词", "存在量词"] },
          ],
        },
        {
          code: "math-sh-prep-inequality",
          name: "相等关系与不等式",
          children: [
            { code: "math-sh-prep-inequality-basic", name: "等式与不等式的性质", difficulty: 2, aliases: ["不等式性质"] },
            { code: "math-sh-prep-inequality-mean", name: "基本不等式", difficulty: 3, aliases: ["基本不等式", "均值不等式"] },
            { code: "math-sh-prep-inequality-quadratic", name: "一元二次方程、方程与不等式", difficulty: 3, aliases: ["一元二次不等式"] },
          ],
        },
      ],
    },
    {
      code: "math-sh-fn",
      name: "函数",
      children: [
        {
          code: "math-sh-fn-concept",
          name: "函数的概念与性质",
          children: [
            { code: "math-sh-fn-concept-def", name: "函数的概念与表示", difficulty: 3, aliases: ["函数的概念"] },
            { code: "math-sh-fn-concept-mono", name: "函数的单调性与最值", difficulty: 3, aliases: ["函数单调性", "函数最值"] },
            { code: "math-sh-fn-concept-parity", name: "函数的奇偶性与周期性", difficulty: 3, aliases: ["函数奇偶性", "函数周期性"] },
          ],
        },
        {
          code: "math-sh-fn-quadratic",
          name: "二次函数",
          children: [
            { code: "math-sh-fn-quadratic-graph", name: "二次函数图象", difficulty: 3, aliases: ["二次函数图象"] },
          ],
        },
        {
          code: "math-sh-fn-elementary",
          name: "基本初等函数",
          children: [
            { code: "math-sh-fn-elementary-power", name: "幂函数", difficulty: 3, aliases: ["幂函数"] },
            { code: "math-sh-fn-elementary-exp", name: "指数函数", difficulty: 3, aliases: ["指数函数"] },
            { code: "math-sh-fn-elementary-log", name: "对数函数", difficulty: 3, aliases: ["对数函数", "对数运算"] },
          ],
        },
        {
          code: "math-sh-fn-trig",
          name: "三角函数",
          children: [
            { code: "math-sh-fn-trig-concept", name: "三角函数的概念与图象", difficulty: 4, aliases: ["三角函数", "正弦函数", "余弦函数"] },
            { code: "math-sh-fn-trig-identity", name: "三角恒等变换", difficulty: 4, aliases: ["三角恒等变换", "两角和差公式"] },
            { code: "math-sh-fn-trig-solve", name: "解三角形", difficulty: 4, aliases: ["正弦定理", "余弦定理", "解三角形"] },
          ],
        },
        {
          code: "math-sh-fn-seq",
          name: "数列",
          children: [
            { code: "math-sh-fn-seq-arithmetic", name: "等差数列", difficulty: 3, aliases: ["等差数列"] },
            { code: "math-sh-fn-seq-geometric", name: "等比数列", difficulty: 3, aliases: ["等比数列"] },
            { code: "math-sh-fn-seq-sum", name: "数列求和", difficulty: 4, aliases: ["数列求和", "错位相减"] },
          ],
        },
        {
          code: "math-sh-fn-derivative",
          name: "导数及其应用",
          children: [
            { code: "math-sh-fn-derivative-concept", name: "导数的概念与运算", difficulty: 4, aliases: ["导数", "求导"] },
            { code: "math-sh-fn-derivative-apply", name: "导数的应用", difficulty: 5, aliases: ["导数应用", "利用导数求单调性", "利用导数求极值"] },
          ],
        },
      ],
    },
    {
      code: "math-sh-geo",
      name: "几何与代数",
      children: [
        {
          code: "math-sh-geo-vector",
          name: "平面向量",
          children: [
            { code: "math-sh-geo-vector-ops", name: "平面向量的概念与运算", difficulty: 3, aliases: ["平面向量", "向量运算"] },
            { code: "math-sh-geo-vector-apply", name: "平面向量的应用", difficulty: 4, aliases: ["向量数量积"] },
          ],
        },
        {
          code: "math-sh-geo-complex",
          name: "复数",
          children: [
            { code: "math-sh-geo-complex-ops", name: "复数的概念与运算", difficulty: 3, aliases: ["复数", "复数运算"] },
          ],
        },
        {
          code: "math-sh-geo-solid",
          name: "立体几何",
          children: [
            { code: "math-sh-geo-solid-body", name: "空间几何体", difficulty: 3, aliases: ["空间几何体", "三视图"] },
            { code: "math-sh-geo-solid-position", name: "点、直线、平面的位置关系", difficulty: 4, aliases: ["线面平行", "线面垂直"] },
            { code: "math-sh-geo-solid-vector", name: "空间向量与立体几何", difficulty: 4, aliases: ["空间向量", "空间角"] },
          ],
        },
        {
          code: "math-sh-geo-analytic",
          name: "解析几何",
          children: [
            { code: "math-sh-geo-analytic-line", name: "直线与方程", difficulty: 3, aliases: ["直线方程", "直线的斜率"] },
            { code: "math-sh-geo-analytic-circle", name: "圆与方程", difficulty: 3, aliases: ["圆的方程"] },
            { code: "math-sh-geo-analytic-conic", name: "圆锥曲线", difficulty: 5, aliases: ["圆锥曲线", "椭圆", "双曲线", "抛物线"] },
          ],
        },
      ],
    },
    {
      code: "math-sh-prob",
      name: "概率与统计",
      children: [
        {
          code: "math-sh-prob-counting",
          name: "计数原理",
          children: [
            { code: "math-sh-prob-counting-permutation", name: "排列与组合", difficulty: 4, aliases: ["排列组合", "排列", "组合"] },
            { code: "math-sh-prob-counting-binomial", name: "二项式定理", difficulty: 4, aliases: ["二项式定理"] },
          ],
        },
        {
          code: "math-sh-prob-probability",
          name: "概率",
          children: [
            { code: "math-sh-prob-probability-classical", name: "古典概型与概率", difficulty: 3, aliases: ["古典概型"] },
            { code: "math-sh-prob-probability-distribution", name: "随机变量及其分布", difficulty: 5, aliases: ["随机变量", "二项分布", "正态分布"] },
            { code: "math-sh-prob-probability-conditional", name: "条件概率与全概率", difficulty: 4, aliases: ["条件概率", "全概率公式"] },
          ],
        },
        {
          code: "math-sh-prob-statistics",
          name: "统计",
          children: [
            { code: "math-sh-prob-statistics-sampling", name: "抽样与统计图表", difficulty: 2, aliases: ["抽样", "统计图表"] },
            { code: "math-sh-prob-statistics-correlation", name: "成对数据的统计分析", difficulty: 4, aliases: ["线性回归", "相关系数"] },
          ],
        },
      ],
    },
  ],
};
