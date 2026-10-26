export type PaperStatusValue = "DRAFT" | "READY";
export type QuestionTypeValue =
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "FILL_BLANK"
  | "CALCULATION"
  | "PROOF"
  | "ESSAY";
export type CognitiveLevelValue =
  | "REMEMBER"
  | "UNDERSTAND"
  | "APPLY"
  | "ANALYZE";

export const QUESTION_TYPES: QuestionTypeValue[] = [
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
];

export const GRADE_LEVELS = [
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export function paperStatusLabel(status: PaperStatusValue): string {
  switch (status) {
    case "DRAFT":
      return "草稿";
    case "READY":
      return "已完成";
  }
}

export function questionTypeLabel(type: QuestionTypeValue): string {
  switch (type) {
    case "SINGLE_CHOICE":
      return "单选题";
    case "MULTI_CHOICE":
      return "多选题";
    case "FILL_BLANK":
      return "填空题";
    case "CALCULATION":
      return "计算题";
    case "PROOF":
      return "证明题";
    case "ESSAY":
      return "解答题";
  }
}

export function gradeLevelLabel(grade: GradeLevel): string {
  switch (grade) {
    case "G5":
      return "五年级";
    case "G6":
      return "六年级";
    case "G7":
      return "初一";
    case "G8":
      return "初二";
    case "G9":
      return "初三";
    case "G10":
      return "高一";
    case "G11":
      return "高二";
    case "G12":
      return "高三";
  }
}

export function cognitiveLevelLabel(level: CognitiveLevelValue): string {
  switch (level) {
    case "REMEMBER":
      return "记忆";
    case "UNDERSTAND":
      return "理解";
    case "APPLY":
      return "应用";
    case "ANALYZE":
      return "分析";
  }
}

export function paperItemSourceLabel(source: string): string {
  if (source === "BANK") return "题库";
  if (source === "AI_GENERATED") return "AI 生成";
  return source;
}

export type AnswerAreaHint = "short" | "medium" | "large" | "extraLarge";

export function answerAreaHeight(hint: AnswerAreaHint): string {
  switch (hint) {
    case "short":
      return "2.4cm";
    case "medium":
      return "5cm";
    case "large":
      return "8.5cm";
    case "extraLarge":
      return "11.5cm";
  }
}

export const TEXTBOOK_VERSIONS = [
  "GENERIC",
  "RENJIAO",
  "BSD",
  "HUASHI",
  "SUKE",
  "ZHEJIAO",
] as const;
export type TextbookVersion = (typeof TEXTBOOK_VERSIONS)[number];

export function textbookVersionLabel(v: TextbookVersion): string {
  switch (v) {
    case "GENERIC":
      return "通用";
    case "RENJIAO":
      return "人教版";
    case "BSD":
      return "北师大版";
    case "HUASHI":
      return "华师大版";
    case "SUKE":
      return "苏科版";
    case "ZHEJIAO":
      return "浙教版";
  }
}

// 大题标题：单选题在统考里归"选择题"，其余沿用题型名。
export function examSectionTitle(type: QuestionTypeValue): string {
  return type === "SINGLE_CHOICE" ? "选择题" : questionTypeLabel(type);
}

// ── 浙江省中考版式（2025 省级统考口径）────────────────────────────────────
// 命题结构：选择 10×3=30 + 填空 6×3=18 + 解答 8 题共 72（8/8/8/8/8/10/10/12），
// 满分 120、120 分钟；试题卷与答题纸分离（答案写在答题纸上）。
export const EXAM_REGION_LABEL = "浙江省";
export const EXAM_STAGE_LABEL = "初中学业水平考试";
export const EXAM_SUBJECT_LABEL = "数　学";

// 试题卷「注意事项」（浙江卷口径，不含任何提分/承诺措辞）。
export const EXAM_NOTICE: readonly string[] = [
  "本卷满分 120 分，考试时间 120 分钟。",
  "答题前，请将姓名、准考证号用黑色字迹的签字笔或钢笔填写在答题纸规定的位置上。",
  "请用黑色字迹的签字笔或钢笔在答题纸指定区域内作答，写在试题卷上无效；选择题作答必须用 2B 铅笔填涂。",
  "本卷不得使用计算器；考试结束后，请将试题卷和答题纸一并交回。",
];

// 答题纸「注意事项」。
export const ANSWER_SHEET_NOTICE: readonly string[] = [
  "答题前，请将姓名、准考证号、试场号、座位号填写清楚，并核对条形码信息。",
  "选择题必须使用 2B 铅笔填涂，修改时用橡皮擦干净；非选择题必须使用黑色字迹的签字笔或钢笔作答。",
  "请按题号在对应的答题区域内作答，超出答题区域的答案无效。",
  "保持答题纸清洁完整，不得折叠、不得在答题纸上做任何标记。",
];

// 解答题在答题纸上的作答区高度（按分值给空间；浙江答题纸常见 A3 双面/4 个 A4 版面，
// 这里控制到 4 页以内：8 分 6cm、10 分 8cm、12 分 10cm）。
export function answerSheetHeight(points: number): string {
  if (points >= 12) return "10cm";
  if (points >= 10) return "8cm";
  if (points >= 8) return "6cm";
  return "5cm";
}

// 大题说明的后半句（浙江卷固定表述）。
export function examSectionNote(type: QuestionTypeValue): string {
  if (type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") {
    return "每小题列出的四个选项中只有一个是符合题目要求的，不选、多选、错选均不得分。";
  }
  if (type === "FILL_BLANK") return "";
  return "解答应写出文字说明、证明过程或演算步骤。";
}
