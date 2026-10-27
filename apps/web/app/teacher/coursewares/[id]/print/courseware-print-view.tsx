"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { CoursewareMarkdown } from "@/components/courseware-markdown";
import { StatePanel } from "@/components/ui/state-panel";
import {
  GRADE_LEVELS,
  gradeLevelLabel,
  type GradeLevel,
} from "@/lib/paper-copy";
import {
  coursewareSectionTypeLabel,
  type CoursewareSectionTypeValue,
} from "@/lib/courseware-copy";

type CoursewareParams = {
  kpNames?: string[];
  teachingGoal?: string | null;
};

const COURSEWARE_PRINT_CSS = `
@media print {
  @page { size: A4; margin: 16mm 14mm; }
  nav, .print-hidden { display: none !important; }
  body { background: white !important; }
  main { padding: 0 !important; }
  .cw-sheet { box-shadow: none !important; border: none !important; padding: 0 !important; }
  .cw-section { break-inside: auto; page-break-inside: auto; }
  .cw-section-heading { break-after: avoid; page-break-after: avoid; }
  .cw-meta { break-inside: avoid; }
  .cw-footer { break-inside: avoid; }
}
`;

function gradeText(gradeLevel: string | null): string | null {
  if (!gradeLevel) return null;
  return GRADE_LEVELS.includes(gradeLevel as GradeLevel)
    ? gradeLevelLabel(gradeLevel as GradeLevel)
    : gradeLevel;
}

export function CoursewarePrintView({ coursewareId }: { coursewareId: string }) {
  const query = trpc.courseware.get.useQuery({ coursewareId }, { retry: false });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return (
      <StatePanel
        title="课件加载失败"
        description="课件不存在，或当前账号没有访问权限。"
      />
    );
  }
  if (!query.data) return null;

  const courseware = query.data.courseware;
  const params = (courseware.paramsJson ?? {}) as CoursewareParams;
  const grade = gradeText(courseware.gradeLevel);
  const kpNames = Array.isArray(params.kpNames) ? params.kpNames : [];

  return (
    <div className="space-y-8 print:space-y-0">
      <style jsx global>{COURSEWARE_PRINT_CSS}</style>

      <div className="print-hidden flex flex-wrap gap-2">
        <Link
          href={`/teacher/coursewares/${courseware.id}`}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          返回预览
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          打印 / 另存 PDF
        </button>
      </div>

      <article className="cw-sheet rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
        {/* 教案卷头：课题 + 年级 / 知识点 / 教学目标 */}
        <header className="border-b-2 border-slate-900 pb-4">
          <p className="text-xs tracking-[0.3em] text-slate-500">智教 AI 课件 · 教学课件</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{courseware.title}</h1>
          <dl className="cw-meta mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700">
            {grade && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-slate-500">年级</dt>
                <dd>{grade}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-slate-500">课时</dt>
              <dd>1 课时（45 分钟）</dd>
            </div>
            {kpNames.length > 0 && (
              <div className="col-span-2 flex gap-2">
                <dt className="shrink-0 text-slate-500">知识点</dt>
                <dd>{kpNames.join("、")}</dd>
              </div>
            )}
            {params.teachingGoal && (
              <div className="col-span-2 flex gap-2">
                <dt className="shrink-0 text-slate-500">教学目标</dt>
                <dd>{params.teachingGoal}</dd>
              </div>
            )}
          </dl>
        </header>

        <div className="mt-6 space-y-8 print:space-y-6">
          {courseware.sections.map((section) => (
            <section key={section.id} className="cw-section">
              <div className="cw-section-heading flex flex-wrap items-baseline gap-2 border-b border-slate-300 pb-1.5">
                <span className="text-sm font-semibold text-slate-500">
                  {String(section.position).padStart(2, "0")}
                </span>
                <span className="rounded-sm bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white print:bg-slate-900">
                  {coursewareSectionTypeLabel(section.type as CoursewareSectionTypeValue)}
                </span>
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              </div>
              <div className="mt-3">
                <CoursewareMarkdown text={section.contentMd} />
              </div>
            </section>
          ))}
        </div>

        <footer className="cw-footer mt-10 border-t border-slate-300 pt-3 text-xs text-slate-500">
          本课件由 AI 生成初稿，教师可在预览页分段编辑并确认后用于课堂。
        </footer>
      </article>
    </div>
  );
}
