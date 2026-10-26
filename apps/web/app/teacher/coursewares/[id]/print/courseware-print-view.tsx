"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { MathText } from "@/components/math-text";
import { StatePanel } from "@/components/ui/state-panel";
import {
  coursewareSectionTypeLabel,
  type CoursewareSectionTypeValue,
} from "@/lib/courseware-copy";

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

  return (
    <div className="space-y-8 print:space-y-6">
      <style jsx global>{`
        @media print {
          nav,
          .print-hidden {
            display: none !important;
          }
          body {
            background: white !important;
          }
          main {
            padding: 0 !important;
          }
        }
      `}</style>

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
          打印
        </button>
      </div>

      <section className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
        <h1 className="text-2xl font-semibold tracking-tight">{courseware.title}</h1>
        <div className="mt-8 space-y-8">
          {courseware.sections.map((section) => (
            <article key={section.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 print:bg-transparent print:px-0">
                  {coursewareSectionTypeLabel(section.type as CoursewareSectionTypeValue)}
                </span>
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-900">
                <MathText text={section.contentMd} />
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
