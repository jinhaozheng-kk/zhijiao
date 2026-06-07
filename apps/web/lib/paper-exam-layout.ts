import { examSectionTitle, type QuestionTypeValue } from "./paper-copy";

export interface ExamLayoutPaperItem {
  id: string;
  type: QuestionTypeValue;
  stemMd: string;
  optionsJson: unknown;
  answerMd: string;
  solutionMd: string;
  rubricMd: string | null;
  points: number;
  position: number;
}

export interface ExamLayoutItem {
  questionNo: number; // 全卷连续小题号
  item: ExamLayoutPaperItem;
}

export interface ExamLayoutSection {
  type: QuestionTypeValue;
  cnIndex: string; // 大题中文序号「一」
  title: string; // 「选择题」
  caption: string; // 「（本大题共 X 小题…）」
  items: ExamLayoutItem[];
  subtotalPoints: number;
  isObjective: boolean;
}

export interface ExamLayout {
  sections: ExamLayoutSection[];
  totalPoints: number;
}

const SECTION_ORDER: QuestionTypeValue[] = [
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
];
const CN_NUM = [
  "一", "二", "三", "四", "五", "六",
  "七", "八", "九", "十", "十一", "十二",
];
const OBJECTIVE: ReadonlySet<QuestionTypeValue> = new Set([
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
]);

export function buildExamLayout(items: ExamLayoutPaperItem[]): ExamLayout {
  // 按题型聚合（保稳定：组内按 position 排序）
  const byType = new Map<QuestionTypeValue, ExamLayoutPaperItem[]>();
  for (const it of items) {
    const list = byType.get(it.type) ?? [];
    list.push(it);
    byType.set(it.type, list);
  }

  const sections: ExamLayoutSection[] = [];
  let questionNo = 0;
  let cnPos = 0;
  let totalPoints = 0;

  for (const type of SECTION_ORDER) {
    const group = byType.get(type);
    if (!group || group.length === 0) continue;
    group.sort((a, b) => a.position - b.position);

    const laidOut: ExamLayoutItem[] = group.map((it) => {
      questionNo += 1;
      return { questionNo, item: it };
    });
    const subtotal = group.reduce((n, it) => n + it.points, 0);
    totalPoints += subtotal;

    const uniform = group.every((it) => it.points === group[0].points);
    const caption = uniform
      ? `（本大题共 ${group.length} 小题，每小题 ${group[0].points} 分，共 ${subtotal} 分）`
      : `（本大题共 ${group.length} 小题，共 ${subtotal} 分）`;

    sections.push({
      type,
      cnIndex: CN_NUM[cnPos] ?? String(cnPos + 1),
      title: examSectionTitle(type),
      caption,
      items: laidOut,
      subtotalPoints: subtotal,
      isObjective: OBJECTIVE.has(type),
    });
    cnPos += 1;
  }

  return { sections, totalPoints };
}
