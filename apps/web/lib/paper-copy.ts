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
