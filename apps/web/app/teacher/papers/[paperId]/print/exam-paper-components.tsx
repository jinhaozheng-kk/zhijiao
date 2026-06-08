"use client";

import {
  TEXTBOOK_VERSIONS,
  answerAreaHeight,
  paperItemSourceLabel,
  textbookVersionLabel,
  type TextbookVersion,
} from "@/lib/paper-copy";
import type { ExamLayout, ExamLayoutSection } from "@/lib/paper-exam-layout";

export const EXAM_PRINT_CSS = `
@media print {
  nav, .print-hidden { display: none !important; }
  body { background: white !important; }
  main { padding: 0 !important; }
  .seal-line { display: flex !important; }
  .exam-print-sheet {
    box-sizing: border-box;
    padding-left: 2.8cm !important;
    width: 100%;
  }
  .answer-space { break-inside: avoid; }
  .print-break-before { break-before: page; page-break-before: always; }
}
`;

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
        姓名_____ 班级_____ 考号_____ ……………装………订………线………内………不………要………答………题……………
      </span>
    </div>
  );
}

export function ExamHeader({
  title,
  gradeLabel,
  textbookVersion,
  durationMinutes,
  totalPoints,
  notice,
  variant,
}: {
  title: string;
  gradeLabel: string;
  textbookVersion?: TextbookVersion;
  durationMinutes?: number;
  totalPoints: number;
  notice: readonly string[];
  variant: "student" | "teacher";
}) {
  const sub: string[] = [];
  if (durationMinutes) sub.push(`考试时长 ${durationMinutes} 分钟`);
  sub.push(`满分 ${totalPoints} 分`);
  if (
    textbookVersion &&
    textbookVersion !== "GENERIC" &&
    TEXTBOOK_VERSIONS.includes(textbookVersion)
  )
    sub.push(textbookVersionLabel(textbookVersion));
  return (
    <header className="text-center">
      <h1 className="text-2xl font-bold tracking-tight">
        {title}
        {variant === "teacher" && <span className="ml-2 text-sm font-normal text-slate-500">（教师卷·含答案）</span>}
      </h1>
      <p className="mt-1 text-sm text-slate-600">{[gradeLabel, ...sub].filter(Boolean).join(" · ")}</p>
      <div className="mt-3 flex justify-center gap-6 text-sm text-slate-700">
        <span>姓名：__________</span>
        <span>班级：__________</span>
        <span>考号：__________</span>
        <span>座位号：______</span>
      </div>
      <ol className="mx-auto mt-3 max-w-2xl list-decimal pl-6 text-left text-xs text-slate-500">
        {notice.map((n) => <li key={n}>{n}</li>)}
      </ol>
    </header>
  );
}

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

function OptionsList({ optionsJson }: { optionsJson: unknown }) {
  if (!Array.isArray(optionsJson)) return null;
  return (
    <ul className="mt-1 space-y-1 text-sm text-slate-800">
      {(optionsJson as string[]).map((opt, idx) => (
        <li key={idx}>{String.fromCharCode(65 + idx)}. {opt}</li>
      ))}
    </ul>
  );
}

export function StudentSection({ section }: { section: ExamLayoutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">
        {section.cnIndex}、{section.title}
        <span className="ml-1 text-xs font-normal text-slate-500">{section.caption}</span>
      </h2>
      <div className="mt-2 space-y-4">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id} className={item.isCapstone ? "print-break-before" : undefined}>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-900">
              {questionNo}. {item.stemMd}
            </p>
            <OptionsList optionsJson={item.optionsJson} />
            {section.type === "FILL_BLANK" && (
              <p className="mt-1 text-sm text-slate-400">答：______________________</p>
            )}
            {!section.isObjective && section.type !== "FILL_BLANK" && (
              <div
                className="answer-space mt-1"
                style={{
                  minHeight: answerAreaHeight(item.answerAreaHint ?? "medium"),
                  borderBottom: "1px solid #e2e8f0",
                }}
              />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function TeacherSection({ section }: { section: ExamLayoutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">
        {section.cnIndex}、{section.title}
        <span className="ml-1 text-xs font-normal text-slate-500">{section.caption}</span>
      </h2>
      <div className="mt-2 space-y-4">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id}>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-900">
              {questionNo}. {item.stemMd}
            </p>
            <OptionsList optionsJson={item.optionsJson} />
            <p className="mt-0.5 text-xs text-slate-400">
              来源：{paperItemSourceLabel(item.source ?? "AI_GENERATED")}
            </p>
            <p className="mt-1 text-sm leading-7"><span className="font-medium">答案：</span>{item.answerMd}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-7"><span className="font-medium">解析：</span>{item.solutionMd}</p>
            {item.rubricMd && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-slate-600"><span className="font-medium">评分标准：</span>{item.rubricMd}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
