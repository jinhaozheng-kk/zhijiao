"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { SkeletonList } from "@/components/ui/skeleton";

export function SessionView() {
  const session = trpc.training.startSession.useQuery({ window: "ALL" });
  const submit = trpc.training.submitAttempt.useMutation();
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const sessionId = session.data?.sessionId;
  const items = useMemo(() => session.data?.items ?? [], [session.data]);

  if (session.isLoading) return <SkeletonList rows={3} />;
  if (session.isError)
    return <StatePanel title="加载失败" description="请稍后再试。" />;
  if (
    !session.data ||
    session.data.status === "INSUFFICIENT_DATA" ||
    items.length === 0
  ) {
    return (
      <StatePanel
        title="还没有足够的训练材料"
        description="先在答疑或作业里积累一些错题，这里会按你的重点巩固方向组成练习。"
        action={
          <Link href="/tutor" className="text-emerald-700 underline">
            去答疑
          </Link>
        }
      />
    );
  }
  if (done) {
    return (
      <StatePanel
        title={`完成 ${items.length} 题，已记入学情`}
        description="坚持按重点方向练习，掌握情况会在学情里更新。"
        action={
          <Link href="/portrait" className="text-emerald-700 underline">
            查看学情
          </Link>
        }
      />
    );
  }

  const item = items[idx]!;
  function mark(selfResult: "KNOW" | "UNSURE") {
    if (!sessionId) return;
    submit.mutate({
      sessionId,
      questionId: item.questionId,
      source: item.source,
      kpIds: item.kpId ? [item.kpId] : [],
      selfResult,
    });
    if (idx + 1 >= items.length) {
      setDone(true);
    } else {
      setIdx(idx + 1);
      setRevealed(false);
    }
  }

  return (
    <div
      className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200"
      data-testid="training-session"
    >
      <div className="text-sm text-slate-500">
        第 {idx + 1} / {items.length} 题{item.level ? ` · ${item.level}` : ""}
      </div>
      <div
        className="whitespace-pre-wrap text-sm leading-6"
        data-testid="training-stem"
      >
        {item.stemMd}
      </div>
      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-full bg-slate-100 px-4 py-2 text-sm"
          data-testid="training-reveal"
        >
          查看解析
        </button>
      ) : (
        <div
          className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm"
          data-testid="training-solution"
        >
          {item.solutionMd ?? "先按方法独立完成，再对照错题本里的解析。"}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => mark("KNOW")}
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white"
          data-testid="training-know"
        >
          会了
        </button>
        <button
          type="button"
          onClick={() => mark("UNSURE")}
          className="rounded-full border px-5 py-3 text-sm"
          data-testid="training-unsure"
        >
          还不熟
        </button>
      </div>
    </div>
  );
}
