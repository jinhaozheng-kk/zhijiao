"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperSpecTable } from "../../paper-detail-components";
import { buildExamLayout } from "@/lib/paper-exam-layout";
import { EXAM_NOTICE, gradeLevelLabel, type GradeLevel, type TextbookVersion } from "@/lib/paper-copy";
import {
  EXAM_PRINT_CSS,
  SealLine,
  ExamHeader,
  ObjectiveAnswerGrid,
  StudentSection,
  TeacherSection,
} from "./exam-paper-components";

type PaperParams = {
  gradeLevel?: GradeLevel;
  textbookVersion?: TextbookVersion;
  durationMinutes?: number;
};

export function PaperPrintView({ paperId }: { paperId: string }) {
  const [variant, setVariant] = useState<"student" | "teacher">("student");
  const query = trpc.paper.get.useQuery({ paperId }, { retry: false });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return <StatePanel title="试卷加载失败" description="试卷不存在，或当前账号没有访问权限。" />;
  }
  if (!query.data) return null;

  const paper = query.data.paper;
  const params = (paper.paramsJson ?? {}) as PaperParams;
  const layout = buildExamLayout(
    paper.items.map((i) => ({
      id: i.id,
      type: i.type as never,
      stemMd: i.stemMd,
      optionsJson: i.optionsJson,
      answerMd: i.answerMd,
      solutionMd: i.solutionMd,
      rubricMd: i.rubricMd,
      points: i.points,
      position: i.position,
    })),
  );
  const gradeLabel = params.gradeLevel ? gradeLevelLabel(params.gradeLevel) : "";

  return (
    <div className="space-y-6">
      <style jsx global>{EXAM_PRINT_CSS}</style>

      <div className="print-hidden flex flex-wrap gap-2">
        <Link href={`/teacher/papers/${paper.id}`} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">返回预览</Link>
        <button
          type="button"
          onClick={() => setVariant("student")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${variant === "student" ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-700"}`}
          data-testid="variant-student"
        >学生卷</button>
        <button
          type="button"
          onClick={() => setVariant("teacher")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${variant === "teacher" ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-700"}`}
          data-testid="variant-teacher"
        >教师卷（含答案）</button>
        <button type="button" onClick={() => window.print()} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">打印</button>
      </div>

      <SealLine />

      <section className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0" data-testid={`paper-${variant}`}>
        <ExamHeader
          title={paper.title}
          gradeLabel={gradeLabel}
          textbookVersion={params.textbookVersion}
          durationMinutes={params.durationMinutes}
          totalPoints={layout.totalPoints}
          notice={EXAM_NOTICE}
          variant={variant}
        />

        {variant === "student" ? (
          <>
            <ObjectiveAnswerGrid layout={layout} />
            {layout.sections.map((s) => <StudentSection key={s.type} section={s} />)}
          </>
        ) : (
          <>
            {layout.sections.map((s) => <TeacherSection key={s.type} section={s} />)}
            <div className="print-break-before mt-8">
              <PaperSpecTable specTable={query.data.specTable} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
