import type { KpNode } from "./types.js";

// 小学数学（《义务教育数学课程标准 2022》第一/二/三学段，1–6 年级）。四领域全覆盖。
// 现有 2 KP（整数加减/乘除）code 保持不变。
// alias 跨学段全局唯一：与初中同名考点（如"平均数"）让出 alias，仅靠唯一 name EXACT 命中。
export const primaryMath: KpNode = {
  code: "math-pri",
  name: "小学",
  children: [
    {
      code: "math-pri-num",
      name: "数与代数",
      children: [
        {
          code: "math-pri-num-cognition",
          name: "数的认识",
          children: [
            { code: "math-pri-num-cognition-integer", name: "整数的认识", difficulty: 1, aliases: ["整数的认识", "万以内数"] },
            { code: "math-pri-num-cognition-fraction", name: "分数的认识", difficulty: 2, aliases: ["分数的认识"] },
            { code: "math-pri-num-cognition-decimal", name: "小数的认识", difficulty: 2, aliases: ["小数的认识"] },
            { code: "math-pri-num-cognition-negative", name: "负数的初步认识", difficulty: 2, aliases: ["负数的初步认识"] },
          ],
        },
        {
          code: "math-pri-num-int",
          name: "整数运算",
          children: [
            { code: "math-pri-num-int-addsub", name: "整数加减法", difficulty: 1, aliases: ["整数加减"] },
            { code: "math-pri-num-int-muldiv", name: "整数乘除法", difficulty: 2, aliases: ["整数乘除"] },
            { code: "math-pri-num-int-mixed", name: "四则混合运算与运算律", difficulty: 2, aliases: ["四则混合运算", "运算律"] },
          ],
        },
        {
          code: "math-pri-num-fracdec",
          name: "分数与小数运算",
          children: [
            { code: "math-pri-num-fracdec-fraction", name: "分数的运算", difficulty: 3, aliases: ["分数运算", "分数加减"] },
            { code: "math-pri-num-fracdec-decimal", name: "小数的运算", difficulty: 2, aliases: ["小数运算"] },
          ],
        },
        {
          code: "math-pri-num-relation",
          name: "数的关系",
          children: [
            { code: "math-pri-num-relation-factor", name: "因数与倍数", difficulty: 2, aliases: ["因数与倍数", "公因数", "公倍数"] },
            { code: "math-pri-num-relation-prime", name: "质数与合数", difficulty: 2, aliases: ["质数", "合数"] },
            { code: "math-pri-num-relation-ratio", name: "比和比例", difficulty: 3, aliases: ["比和比例", "比例"] },
            { code: "math-pri-num-relation-proportion", name: "正比例与反比例", difficulty: 3, aliases: ["正比例与反比例"] },
          ],
        },
        {
          code: "math-pri-num-equation",
          name: "式与方程",
          children: [
            { code: "math-pri-num-equation-letter", name: "用字母表示数", difficulty: 2, aliases: ["用字母表示数"] },
            { code: "math-pri-num-equation-simple", name: "简易方程", difficulty: 3, aliases: ["简易方程"] },
          ],
        },
        {
          code: "math-pri-num-quantity",
          name: "常见的量",
          children: [
            { code: "math-pri-num-quantity-unit", name: "常见的量与单位换算", difficulty: 2, aliases: ["单位换算", "常见的量"] },
          ],
        },
      ],
    },
    {
      code: "math-pri-geo",
      name: "图形与几何",
      children: [
        {
          code: "math-pri-geo-measure",
          name: "图形的认识与测量",
          children: [
            { code: "math-pri-geo-measure-plane", name: "平面图形的认识", difficulty: 1, aliases: ["平面图形"] },
            { code: "math-pri-geo-measure-perimeter", name: "周长", difficulty: 2, aliases: ["周长"] },
            { code: "math-pri-geo-measure-area", name: "面积", difficulty: 2, aliases: ["面积", "长方形面积", "圆的面积"] },
            { code: "math-pri-geo-measure-solid", name: "立体图形的认识", difficulty: 2, aliases: ["立体图形", "长方体", "正方体"] },
            { code: "math-pri-geo-measure-volume", name: "体积与表面积", difficulty: 3, aliases: ["体积", "表面积"] },
          ],
        },
        {
          code: "math-pri-geo-position",
          name: "图形的位置与运动",
          children: [
            { code: "math-pri-geo-position-direction", name: "方向与位置", difficulty: 1, aliases: ["方向与位置", "数对"] },
            { code: "math-pri-geo-position-motion", name: "图形的运动", difficulty: 2, aliases: ["图形的运动"] },
          ],
        },
      ],
    },
    {
      code: "math-pri-stat",
      name: "统计与概率",
      children: [
        {
          code: "math-pri-stat-statistics",
          name: "统计",
          children: [
            { code: "math-pri-stat-statistics-data", name: "数据的收集与整理", difficulty: 2, aliases: ["条形统计图", "折线统计图", "扇形统计图"] },
            // "平均数" alias 已被初中占用；此处仅靠唯一 name EXACT 命中，不重复声明 alias。
            { code: "math-pri-stat-statistics-average", name: "平均数", difficulty: 2 },
          ],
        },
        {
          code: "math-pri-stat-probability",
          name: "可能性",
          children: [
            { code: "math-pri-stat-probability-likelihood", name: "可能性", difficulty: 1, aliases: ["可能性"] },
          ],
        },
      ],
    },
    {
      code: "math-pri-prac",
      name: "综合与实践",
      // 项目式 / 跨学科活动，极少作为单题考点 KP；仅保结构完整。
      children: [
        {
          code: "math-pri-prac-topic",
          name: "综合与实践",
          children: [
            { code: "math-pri-prac-activity", name: "主题活动与数学实践", difficulty: 1, aliases: ["数学实践活动"] },
          ],
        },
      ],
    },
  ],
};
