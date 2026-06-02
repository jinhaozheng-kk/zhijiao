"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { SkeletonList } from "@/components/ui/skeleton";

const ROOT_CAUSE_LABEL: Record<string, string> = {
  CONCEPT_CONFUSION: "概念混淆",
  READING_ERROR: "读题失误",
  FORMULA_MISUSE: "公式误用",
  CALCULATION_SLIP: "计算疏漏",
  TRANSFER_GAP: "迁移不足",
  OTHER: "其它",
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function ErrorBookList() {
  const searchParams = useSearchParams();
  const status = searchParams.get("tab") === "archived" ? "ARCHIVED" : "ACTIVE";

  const q = trpc.error.list.useQuery({ status, limit: 50 });

  return (
    <section data-testid="error-book-list">
      <nav className="flex gap-4 border-b text-sm">
        <Link
          href="/error-book?tab=active"
          data-testid="tab-active"
          className={
            status === "ACTIVE"
              ? "border-b-2 border-slate-900 pb-2 font-medium"
              : "pb-2 text-slate-500"
          }
        >
          错题
        </Link>
        <Link
          href="/error-book?tab=archived"
          data-testid="tab-archived"
          className={
            status === "ARCHIVED"
              ? "border-b-2 border-slate-900 pb-2 font-medium"
              : "pb-2 text-slate-500"
          }
        >
          归档
        </Link>
        <Link
          href="/error-book/review"
          className="ml-auto pb-2 text-emerald-700 underline"
          data-testid="link-review"
        >
          去复习
        </Link>
      </nav>

      {q.isLoading && <div className="mt-4"><SkeletonList rows={3} /></div>}

      {q.isError && (
        <div className="mt-4">
          <StatePanel title="读取错题本失败" description="请稍后再试。" />
        </div>
      )}

      {q.data && q.data.entries.length === 0 && (
        <div className="mt-4" data-testid="empty-list">
          <StatePanel
            title={status === "ACTIVE" ? "还没有错题" : "归档区是空的"}
            description={
              status === "ACTIVE"
                ? "完成一次错因分析后，系统会把需要巩固的题目放到这里。"
                : "归档后的错题会显示在这里。"
            }
            action={
              status === "ACTIVE" ? (
                <Link
                  href="/tutor"
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                >
                  去答疑
                </Link>
              ) : null
            }
          />
        </div>
      )}

      {q.data && q.data.entries.length > 0 && (
        <ul className="mt-4 divide-y overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          {q.data.entries.map((e) => (
            <li key={e.id} className="hover:bg-slate-50">
              <Link
                href={`/error-book/${e.id}`}
                className="block p-3"
                data-testid={`entry-link-${e.id}`}
              >
                <div className="font-medium">
                  {truncate(e.question?.stemMd ?? "(题目已下线)", 80)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  错因：{ROOT_CAUSE_LABEL[e.rootCause] ?? e.rootCause} · 已复习{" "}
                  {e.reviewCount} 次
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
