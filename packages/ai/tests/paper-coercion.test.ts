import { describe, it, expect } from "vitest";
import { coerceOptionArray, coerceStringArray } from "../src/schemas.js";

describe("coerceOptionArray", () => {
  it("数组原样保留（mock 路径 no-op），无前缀不误删", () => {
    expect(coerceOptionArray(["甲", "乙", "丙", "丁"])).toEqual(["甲", "乙", "丙", "丁"]);
    expect(coerceOptionArray(["(0,0)", "(1,1)"])).toEqual(["(0,0)", "(1,1)"]);
  });

  it("换行分隔的字符串 → 数组并剥掉 A./B. 前缀", () => {
    const s = "A. $y=2x+1$\nB. $y=x+2$\nC. $y=2x-1$\nD. $y=x-2$";
    expect(coerceOptionArray(s)).toEqual(["$y=2x+1$", "$y=x+2$", "$y=2x-1$", "$y=x-2$"]);
  });

  it("LaTeX 间距 \\\\[10pt] 分隔的字符串 → 切成 4 项（真实 qwen-max 输出）", () => {
    const s = "A. (0, 3)\\\\[10pt]B. (3, 0)\\\\[10pt]C. (0, -3)\\\\[10pt]D. (-3, 0)";
    expect(coerceOptionArray(s)).toEqual(["(0, 3)", "(3, 0)", "(0, -3)", "(-3, 0)"]);
  });

  it("单反斜杠 \\[10pt] 变体也能切", () => {
    const s = "A. 甲\\[10pt]B. 乙\\[10pt]C. 丙\\[10pt]D. 丁";
    expect(coerceOptionArray(s)).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("\\[1ex] / \\[0.5em] 等非 pt 单位分隔也能切，且不残留间距命令", () => {
    expect(coerceOptionArray("A. 4支\\[1ex]B. 5支\\[1ex]C. 6支\\[1ex]D. 7支")).toEqual([
      "4支",
      "5支",
      "6支",
      "7支",
    ]);
    expect(coerceOptionArray("A. 甲\\[0.5em]B. 乙\\[0.5em]C. 丙\\[0.5em]D. 丁")).toEqual([
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
  });

  it("整行内联的 A./B./C./D. 选项串 → 切成 4 项（真实 qwen-max 输出）", () => {
    expect(coerceOptionArray("A. 5个 B. 6个 C. 7个 D. 8个")).toEqual(["5个", "6个", "7个", "8个"]);
    expect(coerceOptionArray("A. 4小时；B. 5小时；C. 6小时；D. 7小时")).toEqual([
      "4小时",
      "5小时",
      "6小时",
      "7小时",
    ]);
  });

  it("全角括号内联选项（（A）…（B）…）也能切", () => {
    expect(coerceOptionArray("（A）甲（B）乙（C）丙（D）丁")).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("字母不按 A→B→C→D 递增时不误切（保持单项）", () => {
    const raw = "点 B. 在直线 y=2x 上，下列判断正确的是";
    expect(coerceOptionArray(raw)).toEqual([raw]);
  });

  it("数组元素自带的 A. 前缀也会被剥掉（不重复加字母）", () => {
    expect(coerceOptionArray(["A. 甲", "B. 乙"])).toEqual(["甲", "乙"]);
  });

  it("字面量 \\n（反斜杠+n，非真换行）分隔的选项也能切 —— 中考卷失败的真实格式", () => {
    // 真实 DB 里存的就是这种：一个字符串、每项之间是两个字符 \ 和 n
    const raw = "A. 5\\nB. 8\\nC. 10\\nD. 12";
    expect(coerceOptionArray(raw)).toEqual(["5", "8", "10", "12"]);
  });

  it("字面量 \\r\\n 分隔也能切", () => {
    expect(coerceOptionArray("A. 甲\\r\\nB. 乙\\r\\nC. 丙\\r\\nD. 丁")).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("不误伤 LaTeX 命令（\\neq / \\nabla 等）", () => {
    expect(coerceOptionArray("A. $a\\neq b$\nB. $x\\nabla y$")).toEqual(["$a\\neq b$", "$x\\nabla y$"]);
  });

  it("<br> / <br/> / &lt;br&gt; 分隔的选项也能切（真实 qwen-max 另一种输出）", () => {
    expect(coerceOptionArray("A. 2千克<br>B. 4千克<br>C. 5千克<br>D. 10千克")).toEqual([
      "2千克",
      "4千克",
      "5千克",
      "10千克",
    ]);
    expect(coerceOptionArray("A. 甲<br/>B. 乙<br />C. 丙<BR>D. 丁")).toEqual(["甲", "乙", "丙", "丁"]);
    expect(coerceOptionArray("A. 甲&lt;br&gt;B. 乙&lt;br&gt;C. 丙&lt;br&gt;D. 丁")).toEqual([
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
  });

  it("JSON 数组字符串被二次编码成字符串时也能解析", () => {
    const doubleEncoded = '["A. 甲","B. 乙","C. 丙","D. 丁"]';
    expect(coerceOptionArray(doubleEncoded)).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("单元素数组里装着整串选项（数组长度为 1 的字符串）也能切", () => {
    expect(coerceOptionArray(["A. 甲<br>B. 乙<br>C. 丙<br>D. 丁"])).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("完全没有分隔符时按 A→B→C→D 严格顺序兜底切分", () => {
    expect(coerceOptionArray("A. 2千克B. 4千克C. 5千克D. 10千克")).toEqual([
      "2千克",
      "4千克",
      "5千克",
      "10千克",
    ]);
  });

  it("只有零星字母标记时不误切（保持原文）", () => {
    const raw = "点 B. 在直线 y=2x 上，下列判断正确的是";
    expect(coerceOptionArray(raw)).toEqual([raw]);
  });

  it("undefined / 非字符串非数组 原样返回（ESSAY 无 options）", () => {
    expect(coerceOptionArray(undefined)).toBeUndefined();
    expect(coerceOptionArray(null)).toBeNull();
  });
});

describe("coerceStringArray", () => {
  it("数组原样保留", () => {
    expect(coerceStringArray(["一次函数"])).toEqual(["一次函数"]);
  });
  it("单个字符串 → 单元素数组", () => {
    expect(coerceStringArray("一次函数")).toEqual(["一次函数"]);
  });
  it("顿号/逗号分隔的字符串 → 多元素", () => {
    expect(coerceStringArray("一次函数、几何图形")).toEqual(["一次函数", "几何图形"]);
    expect(coerceStringArray("一次函数, 几何图形")).toEqual(["一次函数", "几何图形"]);
  });
});

describe("HTML entity residue cleanup (options)", () => {
  it("strips &emsp;/&nbsp;/&ensp; and trailing lone & from options", () => {
    expect(coerceOptionArray(["20plain &emsp", "30plain &nbsp;", "40plain&", "50 plain"])).toEqual([
      "20plain",
      "30plain",
      "40plain",
      "50 plain",
    ]);
  });

  it("strips space entities from a single option string before splitting", () => {
    const s = "A. alpha &emsp;\nB. beta &nbsp;\nC. gamma\nD. delta";
    expect(coerceOptionArray(s)).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("decodes basic entities (&amp; / &lt; / &gt;)", () => {
    expect(coerceOptionArray(["a &amp; b", "c &lt; d", "e &gt; f"])).toEqual([
      "a & b",
      "c < d",
      "e > f",
    ]);
  });
});