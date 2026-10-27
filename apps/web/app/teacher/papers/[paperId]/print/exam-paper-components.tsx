"use client";

import {
  ANSWER_SHEET_NOTICE,
  EXAM_NOTICE,
  EXAM_REGION_LABEL,
  EXAM_STAGE_LABEL,
  EXAM_SUBJECT_LABEL,
  answerAreaHeight,
  answerSheetHeight,
  examSectionNote,
  paperItemSourceLabel,
} from "@/lib/paper-copy";
import type { FigureSpec } from "@zhijiao/ai";
import type { ExamLayout, ExamLayoutSection } from "@/lib/paper-exam-layout";
import { PaperItemOptions } from "@/components/paper-item-options";
import { PaperFigure } from "@/components/paper-figure";
import { MathText } from "@/components/math-text";

type FigureMap = Record<string, FigureSpec>;

export const EXAM_PRINT_CSS = `
@media print {
  @page { size: A4; margin: 13mm 12mm; }
  nav, .print-hidden { display: none !important; }
  body { background: white !important; }
  main { padding: 0 !important; }
  .seal-line { display: flex !important; }
  .exam-print-sheet {
    box-sizing: border-box;
    padding-left: 2.8cm !important;
    width: 100%;
  }
  .answer-space, .answer-sheet-block { break-inside: avoid; page-break-inside: avoid; }
  .print-break-before { break-before: page; page-break-before: always; }
  .exam-question { break-inside: avoid-page; }
}
`;

export type ExamDocumentVariant = "student" | "sheet" | "teacher";

export function SealLine() {
  return (
    <div
      className="seal-line hidden"
      style={{
        position: "fixed",
        left: "0.6cm",
        top: 0,
        bottom: 0,
        width: "1.6cm",
        alignItems: "center",
        justifyContent: "center",
        borderRight: "1px dashed #000",
      }}
    >
      <span style={{ writingMode: "vertical-rl", letterSpacing: "0.4em", fontSize: "12px" }}>
        姓名_____ 准考证号_____ ……………装………订………线………内………不………要………答………题……………
      </span>
    </div>
  );
}

// 浙江卷卷头：地区 + 考试名称 + 「数 学 试 题 卷 / 答 题 纸」+ 考生信息 + 注意事项。
export function ExamHeader({
  variant,
  totalPoints,
  durationMinutes,
  notice,
  subtitle,
}: {
  variant: ExamDocumentVariant;
  totalPoints: number;
  durationMinutes?: number;
  notice: readonly string[];
  /** 教师卷用：例如「参考答案与解析」。 */
  subtitle?: string;
}) {
  const docTitle =
    variant === "sheet"
      ? `${EXAM_SUBJECT_LABEL}　答　题　纸`
      : variant === "teacher"
        ? `${EXAM_SUBJECT_LABEL}　参　考　答　案`
        : `${EXAM_SUBJECT_LABEL}　试　题　卷`;
  return (
    <header className="text-center text-slate-950">
      <p className="text-[11px] tracking-[0.25em] text-slate-600">
        {EXAM_REGION_LABEL}
        {EXAM_STAGE_LABEL}
      </p>
      <h1 className="mt-1 text-[20px] font-bold tracking-[0.4em]">{docTitle}</h1>
      {variant === "teacher" && subtitle ? (
        <p className="mt-1 text-sm font-medium text-slate-700">{subtitle}</p>
      ) : null}
      <p className="mt-1 text-xs text-slate-600">
        （满分 {totalPoints} 分，考试时间 {durationMinutes ?? 120} 分钟）
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1 text-[13px]">
        <span>姓名：____________</span>
        <span>准考证号：________________</span>
        {variant === "sheet" ? (
          <>
            <span>试场号：________</span>
            <span>座位号：________</span>
          </>
        ) : null}
      </div>
      <div className="mx-auto mt-3 max-w-[92%] border-t border-slate-300 pt-2 text-left text-[11px] leading-5 text-slate-700">
        <p className="font-medium">注意事项：</p>
        <ol className="mt-0.5 list-decimal pl-5">
          {notice.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
    </header>
  );
}

// 保留旧导出：试题卷已不再使用卷头答题栏（浙江卷选择题填涂在答题纸上），
// 但组件仍供内部/测试使用，避免破坏既有引用。
export function ObjectiveAnswerGrid({ layout }: { layout: ExamLayout }) {
  const nums = layout.sections
    .filter((s) => s.isObjective)
    .flatMap((s) => s.items.map((i) => i.questionNo));
  if (nums.length === 0) return null;
  return (
    <div className="mt-4 border border-slate-300 p-2">
      <p className="text-xs font-medium text-slate-600">选择题答题栏</p>
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        {nums.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 border-b border-slate-400 px-2">
            {n}.<span className="inline-block w-8" />
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  section,
  compact = false,
}: {
  section: ExamLayoutSection;
  compact?: boolean;
}) {
  const note = examSectionNote(section.type);
  return (
    <h2 className={`font-semibold text-slate-950 ${compact ? "mt-4 text-[14px] leading-6" : "mt-6 text-base"}`}>
      {section.cnIndex}、{section.title}
      <span className="font-normal">{section.caption}</span>
      {note ? (
        <span className="mt-0.5 block text-[11px] font-normal leading-5 text-slate-600">{note}</span>
      ) : null}
    </h2>
  );
}

function OptionsGrid({ optionsJson }: { optionsJson: unknown }) {
  // 浙江卷选项短，4 个选项排在同一行（放不下自动换行），而非固定两列。
  return (
    <PaperItemOptions
      optionsJson={optionsJson}
      className="mt-0.5 flex flex-wrap gap-x-8 gap-y-0.5 text-[13px] leading-6 text-slate-900"
    />
  );
}

// ── 试题卷：只出题、不留作答区（浙江卷答案写在答题纸上）──────────────────
export function StudentSection({ section, figures }: { section: ExamLayoutSection; figures?: FigureMap }) {
  return (
    <section>
      <SectionHeading section={section} />
      <div className="mt-2 space-y-3">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id} className={item.isCapstone ? "exam-question print-break-before" : "exam-question"}>
            <p className="whitespace-pre-wrap text-[13px] leading-7 text-slate-900">
              {questionNo}.{item.type === "ESSAY" ? `（${item.points}分）` : " "}
              <MathText text={item.stemMd} />
              {section.type === "FILL_BLANK" && !/[_＿]{2,}/.test(item.stemMd) ? "　　____________" : ""}
            </p>
            {section.isObjective ? <OptionsGrid optionsJson={item.optionsJson} /> : null}
            <PaperFigure figure={figures?.[String(item.position)]} className="my-1.5" />
          </article>
        ))}
      </div>
    </section>
  );
}

// ── 教师卷：题目 + 答案 + 解析 + 评分标准 ─────────────────────────────────
export function TeacherSection({ section, figures }: { section: ExamLayoutSection; figures?: FigureMap }) {
  return (
    <section>
      <SectionHeading section={section} compact />
      <div className="mt-1.5 space-y-3">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id} className="exam-question">
            <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-900">
              {questionNo}.（{item.points}分）<MathText text={item.stemMd} />
            </p>
            {section.isObjective ? <OptionsGrid optionsJson={item.optionsJson} /> : null}
            <PaperFigure figure={figures?.[String(item.position)]} className="my-1" maxWidthCm={3.2} />
            <p className="mt-0.5 text-[10px] text-slate-400">
              来源：{paperItemSourceLabel(item.source ?? "AI_GENERATED")}
            </p>
            <p className="mt-0.5 text-[13px] leading-6">
              <span className="font-medium">答案：</span>
              <MathText text={item.answerMd} />
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-6">
              <span className="font-medium">解析：</span>
              <MathText text={item.solutionMd} />
            </p>
            {item.rubricMd ? (
              <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-6 text-slate-600">
                <span className="font-medium">评分标准：</span>
                <MathText text={item.rubricMd} />
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

// ── 答题纸：选择题填涂 + 填空题横线 + 解答题作答框 ─────────────────────
function AnswerSheetObjective({ section }: { section: ExamLayoutSection }) {
  return (
    <section>
      <SectionHeading section={section} compact />
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-2">
        {section.items.map(({ questionNo }) => (
          <div key={questionNo} className="flex w-[9%] min-w-[56px] flex-col items-center border-b border-slate-300 pb-1">
            <span className="text-[12px] font-medium">{questionNo}.</span>
            <div className="mt-0.5 grid grid-cols-4 gap-x-0.5 text-[10px] leading-4 text-slate-700">
              {["A", "B", "C", "D"].map((letter) => (
                <span key={letter} className="inline-flex flex-col items-center">
                  <span className="inline-block h-[8px] w-[8px] rounded-full border border-slate-500" />
                  {letter}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnswerSheetFill({ section }: { section: ExamLayoutSection }) {
  return (
    <section>
      <SectionHeading section={section} compact />
      <div className="mt-2 space-y-2.5">
        {section.items.map(({ questionNo, item }) => (
          <div key={item.id} className="answer-sheet-block flex items-baseline gap-2 text-[13px]">
            <span className="w-7 shrink-0 font-medium">{questionNo}.</span>
            <span className="flex-1 border-b border-slate-500" style={{ height: "1.6em" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function AnswerSheetEssays({ section }: { section: ExamLayoutSection }) {
  return (
    <section>
      <SectionHeading section={section} compact />
      <div className="mt-2 space-y-2">
        {section.items.map(({ questionNo, item }) => (
          // 答题纸按题号顺序连续排版（真实答题纸不为压轴题强制分页），
          // 仅保证单个作答框不被跨页截断。
          <div key={item.id} className="answer-sheet-block">
            <p className="text-[12px] font-medium">
              {questionNo}.（{item.points}分）
            </p>
            <div
              className="mt-1 rounded-[2px] border border-slate-300"
              style={{ minHeight: answerSheetHeight(item.points) }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnswerSheetDocument({
  layout,
  durationMinutes,
}: {
  layout: ExamLayout;
  durationMinutes?: number;
}) {
  const objective = layout.sections.filter((s) => s.isObjective);
  const fills = layout.sections.filter((s) => s.type === "FILL_BLANK");
  const essays = layout.sections.filter((s) => !s.isObjective && s.type !== "FILL_BLANK");
  return (
    <>
      <ExamHeader variant="sheet" totalPoints={layout.totalPoints} durationMinutes={durationMinutes} notice={ANSWER_SHEET_NOTICE} />
      <div className="mt-3">
        {objective.map((s) => (
          <AnswerSheetObjective key={s.type} section={s} />
        ))}
        {fills.map((s) => (
          <AnswerSheetFill key={s.type} section={s} />
        ))}
        {essays.map((s) => (
          <AnswerSheetEssays key={s.type} section={s} />
        ))}
      </div>
    </>
  );
}

// 试题卷默认注意事项（供打印页做兜底，避免各调用点重复）。
export const DEFAULT_EXAM_NOTICE = EXAM_NOTICE;
