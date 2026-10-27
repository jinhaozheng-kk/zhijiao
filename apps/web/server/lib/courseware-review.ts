import { findForbidden } from "@zhijiao/domain";

/**
 * AI 课件（五段式 LESSON_PLAN_GEN）确定性质量门。
 *
 * 分工与出卷一致：schema 只保证「结构合法」（恰好五段 / 五类型各一），内容是否
 * 能进课堂由这里判断。
 *   - BLOCKER：确定不可用（空段、例题无解答、练习无答案、命中禁用措辞、正文过短
 *     到失去教学价值）→ 触发一次带缺陷反馈的修复轮；修复后仍不达标则整次生成失败
 *     （既有扣费补偿链路生效）。
 *   - WARNING：不阻断，落 paramsJson.reviewWarnings，预览页提示教师核对。
 */

export type CoursewareReviewSeverity = "BLOCKER" | "WARNING";

export interface CoursewareReviewIssue {
  sectionType: string;
  severity: CoursewareReviewSeverity;
  code: string;
  message: string;
}

export interface ReviewableCoursewareSection {
  type: string;
  title: string;
  contentMd: string;
}

export interface ReviewableCourseware {
  title: string;
  sections: ReviewableCoursewareSection[];
}

const SECTION_LABEL: Record<string, string> = {
  INTRO: "课堂导入",
  EXPLANATION: "讲解结构",
  EXAMPLE: "例题",
  PITFALL: "易错点",
  EXERCISE: "课堂练习",
};

/** 硬门（BLOCKER）：低于此长度说明该段基本没有可教内容。 */
const SECTION_BLOCKER_MIN: Record<string, number> = {
  INTRO: 120,
  EXPLANATION: 350,
  EXAMPLE: 350,
  PITFALL: 200,
  EXERCISE: 250,
};

/** 提示门（WARNING）：低于此长度说明没达到「可直接进课堂」的完整度。 */
const SECTION_WARN_MIN: Record<string, number> = {
  INTRO: 180,
  EXPLANATION: 520,
  EXAMPLE: 520,
  PITFALL: 300,
  EXERCISE: 380,
};

const TOTAL_CHARS_BLOCKER = 1300;
const TOTAL_CHARS_WARN = 2000;

const AI_ARTIFACT_RE = /作为\s*AI|作为一个?语言模型|\bas an ai\b|我是一个?(AI|人工智能)/i;
const TIME_HINT_RE = /约\s*\d+\s*分钟|（\s*\d+\s*分钟\s*）|\(\s*\d+\s*分钟\s*\)/;
const SOLUTION_MARKER_RE = /(解[:：]|解答|答案|分析[:：]|思路)/;
const ANSWER_SECTION_RE = /(答案|参考答案|解析|提示)/;

function issue(
  sectionType: string,
  severity: CoursewareReviewSeverity,
  code: string,
  message: string,
): CoursewareReviewIssue {
  return { sectionType, severity, code, message };
}

function labelOf(type: string): string {
  return SECTION_LABEL[type] ?? type;
}

/** 逐段检查。sections 已由 schema 保证五段齐全、类型各一。 */
export function reviewCoursewareSection(
  section: ReviewableCoursewareSection,
  totalChars: number,
): CoursewareReviewIssue[] {
  const out: CoursewareReviewIssue[] = [];
  const type = section.type;
  const raw = section.contentMd ?? "";
  const text = raw.trim();
  const len = text.length;
  const push = (severity: CoursewareReviewSeverity, code: string, message: string) =>
    out.push(issue(type, severity, code, message));

  if (len < (SECTION_BLOCKER_MIN[type] ?? 120)) {
    push(
      "BLOCKER",
      "SHORT_SECTION",
      `${labelOf(type)}内容过短（${len} 字），没有可教内容`,
    );
  } else if (len < (SECTION_WARN_MIN[type] ?? 200)) {
    push(
      "WARNING",
      "SHORT_SECTION_WARN",
      `${labelOf(type)}内容偏短（${len} 字），建议补充到 ${SECTION_WARN_MIN[type]} 字以上`,
    );
  }

  if (type === "EXAMPLE" && !SOLUTION_MARKER_RE.test(text)) {
    push("BLOCKER", "EXAMPLE_MISSING_SOLUTION", "例题段缺少解答过程（需写清思路与分步解答）");
  }
  if (type === "EXERCISE" && !ANSWER_SECTION_RE.test(text)) {
    push("BLOCKER", "EXERCISE_MISSING_ANSWER", "课堂练习段缺少参考答案，教师无法直接核对");
  }
  if (type === "PITFALL" && !/(错因|原因|正确做法|正确解法|辨析)/.test(text)) {
    push("WARNING", "PITFALL_NO_REASONING", "易错点段建议按「错误表现 → 错因 → 正确做法」展开");
  }
  if (type === "EXPLANATION") {
    const subheadings = (raw.match(/^#{2,4}\s+\S/gm) ?? []).length;
    if (subheadings < 2) {
      push("WARNING", "MISSING_SUBHEADINGS", "讲解结构段建议用 2 个以上小标题分层");
    }
  }

  if (len > 300 && !raw.includes("\n")) {
    push("WARNING", "NO_LINE_BREAKS", "整段没有换行，建议用 Markdown 列表/小标题分段");
  }
  if (TIME_HINT_RE.test(text) === false && (type === "INTRO" || type === "EXPLANATION")) {
    push("WARNING", "MISSING_TIME_HINT", "缺少建议用时（如「约 5 分钟」），便于教师控制节奏");
  }
  if (AI_ARTIFACT_RE.test(text)) {
    push("WARNING", "AI_ARTIFACT", "疑似 AI 生成痕迹，建议人工核对");
  }

  // 总字数在最后一段统一判断，避免每段都报同一条。
  if (type === "EXERCISE" && totalChars < TOTAL_CHARS_BLOCKER) {
    push("BLOCKER", "SHORT_COURSEWARE", `整份课件仅 ${totalChars} 字，不足以支撑一节课`);
  } else if (type === "EXERCISE" && totalChars < TOTAL_CHARS_WARN) {
    push("WARNING", "SHORT_COURSEWARE_WARN", `整份课件 ${totalChars} 字，建议补充到 ${TOTAL_CHARS_WARN} 字以上`);
  }

  return out;
}

/** 整份课件检查：逐段 + 全卷禁用措辞扫描。 */
export function reviewGeneratedCourseware(
  courseware: ReviewableCourseware,
): CoursewareReviewIssue[] {
  const totalChars = courseware.sections.reduce((n, s) => n + (s.contentMd ?? "").trim().length, 0);
  const issues = courseware.sections.flatMap((section) =>
    reviewCoursewareSection(section, totalChars),
  );

  const corpus = [courseware.title, ...courseware.sections.map((s) => `${s.title}\n${s.contentMd}`)].join("\n");
  const forbidden = findForbidden(corpus);
  if (forbidden.length > 0) {
    issues.unshift(issue("EXERCISE", "BLOCKER", "FORBIDDEN_PHRASE", `命中禁用措辞：${forbidden.join("、")}`));
  }
  return issues;
}

/** 从 paramsJson 读取已落库的 warnings（预览页提示用）。 */
export function getCoursewareReviewWarningsFromParams(params: unknown): CoursewareReviewIssue[] {
  if (!params || typeof params !== "object") return [];
  const maybe = (params as { reviewWarnings?: unknown }).reviewWarnings;
  if (!Array.isArray(maybe)) return [];
  return maybe.filter((entry): entry is CoursewareReviewIssue => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<CoursewareReviewIssue>;
    return typeof item.sectionType === "string" && item.severity === "WARNING" && typeof item.code === "string" && typeof item.message === "string";
  });
}

/**
 * 修复轮指令：把 blocker code 翻成模型能执行的修订要求。
 * 经验（同出卷）：格式/长度类缺陷只重跑同一 prompt 会复现，必须显式给要求。
 */
export function repairInstructionsForCourseware(blockers: CoursewareReviewIssue[]): string[] {
  const byCode = new Set(blockers.map((b) => b.code));
  const shortTypes = new Set(blockers.filter((b) => b.code === "SHORT_SECTION").map((b) => b.sectionType));
  const instructions: string[] = [];

  for (const type of shortTypes) {
    const min = SECTION_BLOCKER_MIN[type] ?? 120;
    const target = SECTION_WARN_MIN[type] ?? 200;
    instructions.push(`${labelOf(type)}段必须扩写到 ${target} 字以上（当前不足 ${min} 字，内容空泛）；要写具体的教学动作与内容，不要重复套话。`);
  }
  if (byCode.has("SHORT_COURSEWARE")) {
    instructions.push("整份课件五段合计不少于 2200 字，按 45 分钟一节课的信息量来写。");
  }
  if (byCode.has("EXAMPLE_MISSING_SOLUTION")) {
    instructions.push("例题段每道题都必须包含：**题目**、**思路分析**、**分步解答**（编号步骤）、**方法总结**，并明确写出答案。");
  }
  if (byCode.has("EXERCISE_MISSING_ANSWER")) {
    instructions.push("课堂练习段末尾必须有 `### 参考答案` 小节，逐题给出答案与关键步骤或提示。");
  }
  if (byCode.has("FORBIDDEN_PHRASE")) {
    instructions.push("删除一切「提分/涨分/必考/保过/通过保证/分数承诺/押题」类措辞。");
  }
  if (byCode.has("MISSING_SUBHEADINGS")) {
    instructions.push("讲解结构段用至少 3 个 `###` 小标题分层，每层讲一个小点。");
  }
  if (byCode.has("MISSING_TIME_HINT")) {
    instructions.push("每段开头用「（约 X 分钟）」标注建议用时。");
  }
  if (byCode.has("NO_LINE_BREAKS")) {
    instructions.push("正文必须用换行与 Markdown 列表/小标题分点，不要写成一整段。");
  }
  return [...new Set(instructions)];
}
