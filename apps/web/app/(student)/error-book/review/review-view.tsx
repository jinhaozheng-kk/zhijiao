"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { plainPreview } from "@/lib/math-segments";

const DAY_MS = 24 * 60 * 60 * 1000;

function truncate(s: string, n: number) {
  return plainPreview(s, n);
}

export function ReviewView() {
  // spec §5.1.4 + UI Reback B: three branches for the empty-state copy.
  //   dueToday.length > 0                       → render list
  //   dueToday.length === 0 && nextReviewAt!==null → "今天没有要复习的；下次 +Xd 后"
  //   dueToday.length === 0 && nextReviewAt===null → "错题本里还没有要复习的题"
  const q = trpc.error.dueForReview.useQuery({ limit: 50 });

  if (q.isLoading) {
    return <p className="mt-6 text-sm text-slate-500">加载中…</p>;
  }

  if (q.isError) {
    return (
      <p className="mt-6 text-sm text-red-600">
        读取复习队列失败：{q.error.message}
      </p>
    );
  }

  const { dueToday, nextReviewAt } = q.data!;

  if (dueToday.length === 0) {
    if (nextReviewAt !== null) {
      // Ceil so "23 hours from now" still reads as "+1 天" instead of "+0 天".
      const daysToNext = Math.max(
        1,
        Math.ceil(
          (new Date(nextReviewAt).getTime() - Date.now()) / DAY_MS,
        ),
      );
      return (
        <div
          className="mt-6 rounded border p-6 text-center"
          data-testid="review-empty-future"
        >
          <p className="text-slate-600">
            今天没有需要复习的错题。下次复习 +{daysToNext} 天后。
          </p>
          <div className="mt-4">
            <Link
              href="/error-book"
              className="text-emerald-700 underline text-sm"
            >
              回错题本
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div
        className="mt-6 rounded border p-6 text-center"
        data-testid="review-empty-none"
      >
        <p className="text-slate-600">错题本里还没有需要复习的题。</p>
        <div className="mt-4">
          <Link href="/tutor" className="text-emerald-700 underline text-sm">
            去答疑
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4" data-testid="review-list">
      <p className="text-sm text-slate-600">
        {dueToday.length} 题待复习。点开任意一题，重新做一遍后回来标记&quot;已复习&quot;。
      </p>
      <ul className="mt-4 divide-y rounded border">
        {dueToday.map((e) => (
          <li key={e.id} className="hover:bg-slate-50">
            <Link
              href={`/error-book/${e.id}`}
              className="block p-3"
              data-testid={`review-link-${e.id}`}
            >
              <div className="font-medium">
                {truncate(e.question?.stemMd ?? "(题目已下线)", 80)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                已复习 {e.reviewCount} 次
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
