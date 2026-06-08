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

// ── Task 2: buildZhongkaoMathBlueprint ──────────────────────────────────────

export interface BlueprintSlot {
  questionNo: number;
  sectionType: SectionType;
  questionType: QuestionTypeValue;
  points: number;
  difficulty: number;
  cognitiveLevel: CognitiveLevelValue;
  kpIds: string[];
  kpNames: string[];
  intent: string;
  constraints: string[];
  answerAreaHint: AnswerAreaHint;
  isCapstone: boolean;
}

export interface ZhongkaoMathBlueprint {
  styleTemplate: typeof ZHONGKAO_TEMPLATE_ID;
  blueprintVersion: "v1";
  examStage: "ZHONGKAO";
  subject: "MATH";
  gradeLevel: GradeLevel;
  durationMinutes: number;
  textbookVersion: TextbookVersion;
  isTopical: boolean;
  slots: BlueprintSlot[];
}

const TOPICAL_KP_THRESHOLD = 3; // 少于 3 个 KP → 专题练习卷

function answerAreaHintFor(args: {
  questionType: QuestionTypeValue;
  points: number;
  isCapstone: boolean;
}): AnswerAreaHint {
  if (args.questionType === "SINGLE_CHOICE" || args.questionType === "MULTI_CHOICE") return "short";
  if (args.questionType === "FILL_BLANK") return "short";
  if (args.isCapstone) return "extraLarge";
  return args.points >= 10 ? "large" : "medium";
}

// 注：KP 按题位轮转分配；若 KP 数 > 24（题位数），多出的 KP 不会被分配（v1 KP 数远小于 24）。
export function buildZhongkaoMathBlueprint(args: {
  gradeLevel: GradeLevel;
  durationMinutes: number;
  textbookVersion: TextbookVersion;
  kps: Array<{ id: string; name: string }>;
}): ZhongkaoMathBlueprint {
  if (args.kps.length === 0) throw new Error("中考风格卷至少一个知识点");

  const slots: BlueprintSlot[] = [];
  let questionNo = 0;
  let kpCursor = 0;

  for (const sec of ZHONGKAO_GENERIC_TEMPLATE) {
    const count = sec.pointsLadder.length;
    if (sec.difficultyLadder.length !== count) {
      throw new Error(`模板大题「${sec.sectionType}」分值与难度阶梯长度不一致`);
    }
    for (let i = 0; i < count; i++) {
      questionNo += 1;
      const isCapstone = i >= count - sec.capstoneTail;
      const points = sec.pointsLadder[i]!;
      const difficulty = sec.difficultyLadder[i]!;
      const kp = args.kps[kpCursor % args.kps.length]!;
      kpCursor += 1;
      slots.push({
        questionNo,
        sectionType: sec.sectionType,
        questionType: sec.questionType,
        points,
        difficulty,
        cognitiveLevel: sec.cognitiveLevel,
        kpIds: [kp.id],
        kpNames: [kp.name],
        intent: sec.intent,
        constraints: [...sec.constraints],
        answerAreaHint: answerAreaHintFor({ questionType: sec.questionType, points, isCapstone }),
        isCapstone,
      });
    }
  }

  return {
    styleTemplate: ZHONGKAO_TEMPLATE_ID,
    blueprintVersion: "v1",
    examStage: "ZHONGKAO",
    subject: "MATH",
    gradeLevel: args.gradeLevel,
    durationMinutes: args.durationMinutes,
    textbookVersion: args.textbookVersion,
    isTopical: args.kps.length < TOPICAL_KP_THRESHOLD,
    slots,
  };
}

// ── Task 7: blueprintToAiSections + assignItemsToSlots + applySlotMetadata ──

export interface BlueprintAiInputs {
  sections: Array<{ type: QuestionTypeValue; count: number }>;
  slotHints: Array<{ type: QuestionTypeValue; intent: string; constraints: string[] }>;
}

export function blueprintToAiSections(bp: ZhongkaoMathBlueprint): BlueprintAiInputs {
  const order: QuestionTypeValue[] = [];
  const counts = new Map<QuestionTypeValue, number>();
  const hints = new Map<QuestionTypeValue, { intent: string; constraints: string[] }>();
  for (const slot of bp.slots) {
    if (!counts.has(slot.questionType)) order.push(slot.questionType);
    counts.set(slot.questionType, (counts.get(slot.questionType) ?? 0) + 1);
    if (!hints.has(slot.questionType)) hints.set(slot.questionType, { intent: slot.intent, constraints: slot.constraints });
  }
  return {
    sections: order.map((type) => ({ type, count: counts.get(type)! })),
    slotHints: order.map((type) => ({ type, ...hints.get(type)! })),
  };
}

// 生成回来的题（任意来源：题库 + AI）按题型顺序 zip 到 slot。
export interface AssignableItem {
  stemMd: string;
  type: QuestionTypeValue;
  options?: string[];
  answerMd: string;
  solutionMd: string;
  rubricMd?: string;
  difficulty: number;
  cognitiveLevel: CognitiveLevelValue;
  points: number;
  knowledgePointHints: string[];
}

export interface AssignedPair {
  slot: BlueprintSlot;   // 权威元数据：落库用 slot.points/difficulty/cognitiveLevel
  item: AssignableItem;  // RAW AI/题库原值，未覆盖——供审题比对（如 DIFFICULTY_DRIFT）
}

// 仅 zip，不覆盖。覆盖延后到落库（applySlotMetadata）；审题在覆盖前跑，才能比 RAW 难度。
export function assignItemsToSlots(bp: ZhongkaoMathBlueprint, items: AssignableItem[]): AssignedPair[] {
  const byType = new Map<QuestionTypeValue, AssignableItem[]>();
  for (const it of items) {
    const list = byType.get(it.type) ?? [];
    list.push(it);
    byType.set(it.type, list);
  }
  const cursors = new Map<QuestionTypeValue, number>();
  const pairs: AssignedPair[] = [];
  for (const slot of bp.slots) {
    const pool = byType.get(slot.questionType) ?? [];
    const idx = cursors.get(slot.questionType) ?? 0;
    const raw = pool[idx];
    if (!raw) throw new Error(`INSUFFICIENT_ITEMS_FOR_TYPE:${slot.questionType}`);
    cursors.set(slot.questionType, idx + 1);
    pairs.push({ slot, item: raw });
  }
  return pairs;
}

// 落库前把 slot 权威元数据应用到 item（spec §4.2「不采信 AI 自行调整」）。
export function applySlotMetadata(pair: AssignedPair): AssignableItem {
  return {
    ...pair.item,
    points: pair.slot.points,
    difficulty: pair.slot.difficulty,
    cognitiveLevel: pair.slot.cognitiveLevel,
  };
}
