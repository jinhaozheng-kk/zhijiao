"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperSpecTable } from "../../paper-detail-components";
import { buildExamLayout } from "@/lib/paper-exam-layout";
import type { FigureSpec } from "@zhijiao/ai";
import {
  EXAM_NOTICE,
  type AnswerAreaHint,
  type GradeLevel,
  type TextbookVersion,
  type QuestionTypeValue,
} from "@/lib/paper-copy";
import {
  EXAM_PRINT_CSS,
  SealLine,
  ExamHeader,
  StudentSection,
  TeacherSection,
  AnswerSheetDocument,
  type ExamDocumentVariant,
} from "./exam-paper-components";

type PaperParams = {
  gradeLevel?: GradeLevel;
  textbookVersion?: TextbookVersion;
  durationMinutes?: number;
  blueprint?: {
    slots: Array<{
      questionNo: number;
      answerAreaHint: AnswerAreaHint;
      isCapstone: boolean;
    }>;
  };
  reviewBlockers?: Array<{
    slotQuestionNo: number;
    code: string;
    message: string;
  }>;
  /** 浙江卷配图：按 item.position（1-based）存 FigureSpec。 */
  figures?: Record<string, FigureSpec>;
};

const VARIANT_LABEL: Record<ExamDocumentVariant, string> = {
  student: "试题卷",
  sheet: "答题纸",
  teacher: "参考答案（含解析）",
};

export function PaperPrintView({ paperId }: { paperId: string }) {
  const [variant, setVariant] = useState<ExamDocumentVariant>("student");
  const query = trpc.paper.get.useQuery({ paperId }, { retry: false });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return <StatePanel title="试卷加载失败" description="试卷不存在，或当前账号没有访问权限。" />;
  }
  if (!query.data) return null;

  const paper = query.data.paper;
  const params = (paper.paramsJson ?? {}) as PaperParams;
  const reviewBlockers = params.reviewBlockers ?? [];
  const hasReviewBlockers = reviewBlockers.length > 0;
  const slotByPosition = new Map((params.blueprint?.slots ?? []).map((s) => [s.questionNo, s]));
  const layout = buildExamLayout(
    paper.items.map((i) => ({
      id: i.id,
      type: i.type as QuestionTypeValue,
      stemMd: i.stemMd,
      optionsJson: i.optionsJson,
      answerMd: i.answerMd,
      solutionMd: i.solutionMd,
      rubricMd: i.rubricMd,
      points: i.points,
      position: i.position,
      answerAreaHint: slotByPosition.get(i.position)?.answerAreaHint,
      isCapstone: slotByPosition.get(i.position)?.isCapstone,
      source: i.source,
    })),
  );
  const durationMinutes = params.durationMinutes ?? 120;
  const figures = params.figures ?? {};

  return (
    <div className="space-y-6">
      <style jsx global>{EXAM_PRINT_CSS}</style>

      <div className="print-hidden flex flex-wrap items-center gap-2">
        <Link
          href={`/teacher/papers/${paper.id}`}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          返回预览
        </Link>
        {(Object.keys(VARIANT_LABEL) as ExamDocumentVariant[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setVariant(key)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              variant === key ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-700"
            }`}
            data-testid={`variant-${key}`}
          >
            {VARIANT_LABEL[key]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          disabled={hasReviewBlockers}
          title={hasReviewBlockers ? "自动审题存在必须修正的问题，不能打印最终卷" : undefined}
          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          打印当前页
        </button>
      </div>

      <p className="print-hidden rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
        浙江省中考为「试题卷 + 答题纸」分离：先打印<b>试题卷</b>，再打印<b>答题纸</b>发给学生作答；「参考答案」供教师阅卷使用。
        每份文档单独打印（浏览器打印对话框里选择对应页）。
      </p>

      {hasReviewBlockers && (
        <div className="print-hidden rounded-lg bg-red-50 p-4 text-sm text-red-800" data-testid="print-review-blocked">
          <p className="font-medium">自动审题未通过，不能打印最终卷。</p>
          <ul className="mt-2 space-y-1">
            {reviewBlockers.map((blocker, index) => (
              <li key={`${blocker.slotQuestionNo}-${blocker.code}-${index}`}>
                第 {blocker.slotQuestionNo} 题：{blocker.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SealLine />

      <section
        className="exam-print-sheet rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0"
        data-testid={`paper-${variant}`}
      >
        {variant === "student" && (
          <>
            <ExamHeader variant="student" totalPoints={layout.totalPoints} durationMinutes={durationMinutes} notice={EXAM_NOTICE} />
            {layout.sections.map((s) => (
              <StudentSection key={s.type} section={s} figures={figures} />
            ))}
          </>
        )}

        {variant === "sheet" && (
          <AnswerSheetDocument layout={layout} durationMinutes={durationMinutes} />
        )}

        {variant === "teacher" && (
          <>
            <ExamHeader
              variant="teacher"
              totalPoints={layout.totalPoints}
              durationMinutes={durationMinutes}
              notice={EXAM_NOTICE}
              subtitle="参考答案与评分说明"
            />
            {layout.sections.map((s) => (
              <TeacherSection key={s.type} section={s} figures={figures} />
            ))}
            <div className="print-break-before mt-8">
              <PaperSpecTable specTable={query.data.specTable} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
