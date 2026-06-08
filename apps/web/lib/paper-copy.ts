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

// 静态注意事项模板（合规：无提分/分数/保过措辞）。
export const EXAM_NOTICE: readonly string[] = [
  "答题前请将姓名、班级、考号填写清楚。",
  "选择题答案填涂在卷头答题栏内，其余各题在对应题目下方作答。",
  "请保持卷面整洁，字迹清楚。",
];
