"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  PaperItemSourcePill,
  PaperSpecTable,
  PrintLink,
} from "../paper-detail-components";
import { questionTypeLabel, type QuestionTypeValue } from "@/lib/paper-copy";

type PaperItem = {
  id: string;
  position: number;
  source: string;
  stemMd: string;
  type: string;
  answerMd: string;
  solutionMd: string;
  points: number;
  difficulty: number;
  kpHints: string[];
};

function PaperItemCard({
  paperId,
  item,
  disabled,
}: {
  paperId: string;
  item: PaperItem;
  disabled: boolean;
}) {
  const utils = trpc.useUtils();
  const [points, setPoints] = useState(item.points);
  const updatePoints = trpc.paper.updateItemPoints.useMutation({
    onSuccess: () => utils.paper.get.invalidate({ paperId }),
  });
  const removeItem = trpc.paper.removeItem.useMutation({
    onSuccess: () => utils.paper.get.invalidate({ paperId }),
  });

  function savePoints() {
    if (points === item.points) return;
    updatePoints.mutate({ paperId, itemId: item.id, points });
  }

  return (
    <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500">
            第 {item.position} 题
          </span>
          <PaperItemSourcePill source={item.source} />
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {questionTypeLabel(item.type as QuestionTypeValue)}
          </span>
          <span className="text-xs text-slate-500">难度 {item.difficulty}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600" htmlFor={`points-${item.id}`}>
            分值
          </label>
          <input
            id={`points-${item.id}`}
            type="number"
            min={0}
            max={100}
            value={points}
            disabled={disabled || updatePoints.isPending}
            onChange={(e) => setPoints(Number(e.target.value))}
            onBlur={savePoints}
            className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-900">
        {item.stemMd}
      </p>
      {item.kpHints.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          知识点：{item.kpHints.join("、")}
        </p>
      ) : null}
      <details className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          答案解析
        </summary>
        <div className="mt-3 space-y-3 leading-7 text-slate-700">
          <p>
            <span className="font-medium">答案：</span>
            {item.answerMd}
          </p>
          <p className="whitespace-pre-wrap">
            <span className="font-medium">解析：</span>
            {item.solutionMd}
          </p>
        </div>
      </details>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={disabled || removeItem.isPending}
          onClick={() => removeItem.mutate({ paperId, itemId: item.id })}
          className="rounded-full border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          删题
        </button>
      </div>
    </article>
  );
}

export function PaperPreviewView({ paperId }: { paperId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.paper.get.useQuery({ paperId }, { retry: false });
  const markReady = trpc.paper.markReady.useMutation({
    onSuccess: () => utils.paper.get.invalidate({ paperId }),
  });

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
  const disabled = paper.status === "READY";

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{paper.title}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {paper.items.length} 题 · {query.data.specTable.totalPoints} 分
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintLink paperId={paper.id} />
            <button
              type="button"
              disabled={disabled || markReady.isPending}
              onClick={() => markReady.mutate({ paperId })}
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disabled ? "已确认完成" : "确认完成"}
            </button>
          </div>
        </div>
      </section>

      <PaperSpecTable specTable={query.data.specTable} />

      <section className="space-y-4">
        {paper.items.map((item) => (
          <PaperItemCard
            key={item.id}
            paperId={paper.id}
            item={item}
            disabled={disabled}
          />
        ))}
        {paper.items.length === 0 ? (
          <StatePanel title="试卷暂无题目" description="可以返回列表重新生成一份试卷。" />
        ) : null}
      </section>
    </div>
  );
}
