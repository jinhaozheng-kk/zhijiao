import type {
  GradeLevel,
  QuestionTypeValue,
  TextbookVersion,
  CognitiveLevelValue,
} from "./paper-copy";

export type SectionType = "选择题" | "填空题" | "解答题";
export type AnswerAreaHint = "short" | "medium" | "large" | "extraLarge";

export const ZHONGKAO_TEMPLATE_ID = "JUNIOR_MATH_ZHONGKAO_GENERIC_V1" as const;
export const ZHONGKAO_TEMPLATE_LABEL = "初中数学通用中考风格 v1";

export interface BlueprintTemplateSection {
  sectionType: SectionType;
  questionType: QuestionTypeValue;
  pointsLadder: number[]; // 每题位分值，长度即题量
  difficultyLadder: number[]; // 每题位难度，1–5，与 pointsLadder 等长
  cognitiveLevel: CognitiveLevelValue;
  intent: string;
  constraints: string[];
  capstoneTail: number; // 本大题末尾 N 题标 isCapstone
}

// spec §2 默认结构。解答题统一映射到 ESSAY（同一大题），用分值/作答区/压轴区分层级，
// 避免 CALCULATION/PROOF/ESSAY 拆成多个 大题 破坏中考卷「三、解答题」单大题观感。
export const ZHONGKAO_GENERIC_TEMPLATE: BlueprintTemplateSection[] = [
  {
    sectionType: "选择题",
    questionType: "SINGLE_CHOICE",
    pointsLadder: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    difficultyLadder: [1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
    cognitiveLevel: "UNDERSTAND",
    intent: "考查基础概念辨析、基本运算、图形识别与函数图像",
    constraints: ["题干简洁", "只有一个正确答案", "不提示解法"],
    capstoneTail: 0,
  },
  {
    sectionType: "填空题",
    questionType: "FILL_BLANK",
    pointsLadder: [3, 3, 3, 3, 3, 3],
    difficultyLadder: [2, 2, 3, 3, 3, 4],
    cognitiveLevel: "APPLY",
    intent: "考查代数运算、几何性质、函数关系与数据处理",
    constraints: ["答案唯一", "不提供选项", "不提示解法"],
    capstoneTail: 0,
  },
  {
    sectionType: "解答题",
    questionType: "ESSAY",
    pointsLadder: [6, 6, 8, 8, 10, 10, 12, 12],
    difficultyLadder: [2, 2, 3, 3, 4, 4, 5, 5],
    cognitiveLevel: "ANALYZE",
    intent: "考查计算、证明、应用建模、函数综合与几何综合",
    constraints: ["解题步骤完整", "条件唯一确定", "不直接提示解法"],
    capstoneTail: 2,
  },
];
