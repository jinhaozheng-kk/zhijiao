"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperSpecTable } from "../../paper-detail-components";
import { questionTypeLabel, type QuestionTypeValue } from "@/lib/paper-copy";

export function PaperPrintView({ paperId }: { paperId: string }) {
  const query = trpc.paper.get.useQuery({ paperId }, { retry: false });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return (
      <StatePanel
        title="试卷加载失败"
        description="试卷不存在，或当前账号没有访问权限。"
      />
    );
  }
  if (!query.data) return null;

  const paper = query.data.paper;

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
          .print-break-before {
            break-before: page;
            page-break-before: always;
          }
        }
      `}</style>

      <div className="print-hidden flex flex-wrap gap-2">
        <Link
          href={`/teacher/papers/${paper.id}`}
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
        <h1 className="text-2xl font-semibold tracking-tight">{paper.title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          共 {paper.items.length} 题 · {query.data.specTable.totalPoints} 分
        </p>
        <div className="mt-8 space-y-6">
          {paper.items.map((item) => (
            <article key={item.id}>
              <div className="flex flex-wrap gap-2 text-sm text-slate-500">
                <span>第 {item.position} 题</span>
                <span>{questionTypeLabel(item.type as QuestionTypeValue)}</span>
                <span>{item.points} 分</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-900">
                {item.stemMd}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="print-break-before rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
        <h2 className="text-xl font-semibold tracking-tight">答案解析</h2>
        <div className="mt-6 space-y-6">
          {paper.items.map((item) => (
            <article key={item.id}>
              <h3 className="text-sm font-medium">第 {item.position} 题</h3>
              <p className="mt-2 text-sm leading-7">
                <span className="font-medium">答案：</span>
                {item.answerMd}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                <span className="font-medium">解析：</span>
                {item.solutionMd}
              </p>
            </article>
          ))}
        </div>
      </section>

      <div className="print-break-before">
        <PaperSpecTable specTable={query.data.specTable} />
      </div>
    </div>
  );
}
