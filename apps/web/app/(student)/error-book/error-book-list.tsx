"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

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

      {q.isLoading && <p className="mt-4 text-sm text-slate-500">加载中…</p>}

      {q.isError && (
        <p className="mt-4 text-sm text-red-600">
          读取错题本失败：{q.error.message}
        </p>
      )}

      {q.data && q.data.entries.length === 0 && (
        <p className="mt-4 text-sm text-slate-500" data-testid="empty-list">
          {status === "ACTIVE"
            ? "还没有错题。答题答错后可以从答疑卡片加入错题本。"
            : "归档区是空的。"}
        </p>
      )}

      {q.data && q.data.entries.length > 0 && (
        <ul className="mt-4 divide-y rounded border">
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
