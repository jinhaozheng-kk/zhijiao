"use client";

import { trpc } from "@/lib/trpc-client";
import { EntryActions } from "../entry-actions";

const ROOT_CAUSE_LABEL: Record<string, string> = {
  CONCEPT_CONFUSION: "概念混淆",
  READING_ERROR: "读题失误",
  FORMULA_MISUSE: "公式误用",
  CALCULATION_SLIP: "计算疏漏",
  TRANSFER_GAP: "迁移不足",
  OTHER: "其它",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "活跃",
  ARCHIVED: "已归档",
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function EntryDetail({ entryId }: { entryId: string }) {
  const q = trpc.error.getById.useQuery({ entryId });

  if (q.isLoading) {
    return <p className="mt-6 text-sm text-slate-500">加载中…</p>;
  }

  if (q.isError) {
    // validateEntryOwnership returns NOT_FOUND for missing / cross-user / DELETED.
    // We treat all three the same way: there is no "this entry exists but you can't
    // see it" state on purpose — spec §5.3 forbids the existence side-channel.
    const code = (q.error.data as { code?: string } | undefined)?.code;
    if (code === "NOT_FOUND") {
      return (
        <div className="mt-6" data-testid="entry-not-found">
          <h2 className="text-xl font-semibold">未找到这道错题</h2>
          <p className="mt-2 text-sm text-slate-600">
            它可能已经被你从错题本移除了。
          </p>
        </div>
      );
    }
    return (
      <p className="mt-6 text-sm text-red-600">
        读取错题失败：{q.error.message}
      </p>
    );
  }

  const { entry, question, variantGroups } = q.data!;

  return (
    <div className="mt-4 space-y-6" data-testid="entry-detail">
      <header>
        <h1 className="text-2xl font-bold">错题详情</h1>
        <div className="mt-1 text-xs text-slate-500">
          状态：{STATUS_LABEL[entry.status] ?? entry.status} · 已复习{" "}
          {entry.reviewCount} 次
        </div>
      </header>

      <section className="rounded border p-4">
        <h2 className="font-semibold">题目</h2>
        <div className="mt-2 whitespace-pre-wrap text-sm">{question.stemMd}</div>
        {question.answer?.contentMd && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-600">
              查看参考答案
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-sm">
              {question.answer.contentMd}
            </div>
          </details>
        )}
      </section>

      <section className="rounded border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold">错因分析</h2>
        <div className="mt-2 text-sm">
          <span className="font-medium">分类：</span>
          {ROOT_CAUSE_LABEL[entry.rootCause] ?? entry.rootCause}
        </div>
        <div
          className="mt-2 whitespace-pre-wrap text-sm"
          data-testid="entry-reasoning"
        >
          {entry.rootCauseReasoning}
        </div>
        {entry.actualAnswerMd && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-600">
              查看我当时的作答
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-sm">
              {entry.actualAnswerMd}
            </div>
          </details>
        )}
      </section>

      <EntryActions entryId={entry.id} status={entry.status} />

      <section data-testid="variant-groups">
        <h2 className="font-semibold">举一反三（{variantGroups.length} 组）</h2>
        {variantGroups.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            还没有生成过变式。点上方&quot;生成变式&quot;按钮试试（消耗 3 credits）。
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {variantGroups.map((g) => (
              <li key={g.id} className="rounded border p-3">
                <div className="text-xs text-slate-500">
                  生成于 {new Date(g.createdAt).toLocaleString()} · 消耗{" "}
                  {g.creditsCost} credits
                </div>
                <ul className="mt-2 space-y-2">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">
                          {it.level} · {truncate(it.stemMd, 60)}
                        </summary>
                        <div className="mt-2 ml-4 whitespace-pre-wrap text-sm">
                          {it.stemMd}
                        </div>
                        <details className="mt-2 ml-4">
                          <summary className="cursor-pointer text-sm text-emerald-700">
                            查看解析
                          </summary>
                          <div className="mt-1 whitespace-pre-wrap text-sm">
                            {it.solutionMd}
                          </div>
                        </details>
                      </details>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
