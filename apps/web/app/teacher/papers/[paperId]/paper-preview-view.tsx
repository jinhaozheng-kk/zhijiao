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
import {
  questionTypeLabel,
  cognitiveLevelLabel,
  type QuestionTypeValue,
  type CognitiveLevelValue,
} from "@/lib/paper-copy";
import { PaperItemOptions } from "@/components/paper-item-options";
import { PaperFigure } from "@/components/paper-figure";
import { MathText } from "@/components/math-text";
import type { FigureSpec } from "@zhijiao/ai";
import { ZHONGKAO_TEMPLATE_LABEL } from "@/lib/zhongkao-blueprint";

type PaperItem = {
  id: string;
  position: number;
  source: string;
  stemMd: string;
  type: string;
  /** 选择题选项（PaperItem.optionsJson）；非选择题为 null。 */
  optionsJson?: unknown;
  answerMd: string;
  solutionMd: string;
  points: number;
  difficulty: number;
  kpHints: string[];
};

type ZhongkaoPreviewParams = {
  styleTemplate?: string;
  blueprint?: {
    isTopical: boolean;
    slots: Array<{
      questionNo: number;
      questionType: string;
      points: number;
      difficulty: number;
      cognitiveLevel: string;
      intent: string;
      kpNames: string[];
      isCapstone: boolean;
    }>;
  };
  reviewWarnings?: Array<{
    slotQuestionNo: number;
    code: string;
    message: string;
  }>;
  reviewBlockers?: Array<{
    slotQuestionNo: number;
    code: string;
    message: string;
  }>;
  /** 浙江卷配图：按题号（1-based position）存 FigureSpec。 */
  figures?: Record<string, FigureSpec>;
};

function PaperItemCard({
  paperId,
  item,
  disabled,
  hasWarning,
  hasBlocker,
  figure,
}: {
  paperId: string;
  item: PaperItem;
  disabled: boolean;
  hasWarning?: boolean;
  hasBlocker?: boolean;
  figure?: FigureSpec | null;
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
    <article
      id={`paper-item-${item.position}`}
      className={`rounded-lg bg-white p-5 shadow-sm ring-1 ${hasBlocker ? "ring-2 ring-red-500" : hasWarning ? "ring-2 ring-amber-400" : "ring-slate-200"}`}
    >
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
        <MathText text={item.stemMd} />
      </p>
      <PaperItemOptions optionsJson={item.optionsJson} />
      <PaperFigure figure={figure} className="my-2" />
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
            <MathText text={item.answerMd} />
          </p>
          <p className="whitespace-pre-wrap">
            <span className="font-medium">解析：</span>
            <MathText text={item.solutionMd} />
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
  const params = (paper.paramsJson ?? {}) as ZhongkaoPreviewParams;
  const reviewWarnings = params.reviewWarnings ?? [];
  const reviewBlockers = params.reviewBlockers ?? [];
  const warnedPositions = new Set(reviewWarnings.map((w) => w.slotQuestionNo));
  const blockedPositions = new Set(reviewBlockers.map((w) => w.slotQuestionNo));
  const markReadyDisabled = disabled || reviewBlockers.length > 0 || markReady.isPending;

  return (
    <div className="space-y-6">
      {/* B1-UI: DRAFT notice banner */}
      {paper.status !== "READY" && (
        <div
          className="rounded-lg bg-blue-50 px-5 py-3 text-sm text-blue-800"
          data-testid="ai-draft-notice"
        >
          本试卷由 AI 辅助生成，题目内容（尤其计算步骤）可能有误，请逐题核对后再点「确认完成」。
        </div>
      )}

      {paper.status !== "READY" && reviewBlockers.length > 0 && (
        <div
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          data-testid="review-blockers"
        >
          <p className="font-medium">必须修正后才能确认完成（{reviewBlockers.length}）</p>
          <ul className="mt-2 space-y-1">
            {reviewBlockers.map((blocker, index) => (
              <li key={`${blocker.slotQuestionNo}-${blocker.code}-${index}`}>
                <a
                  href={`#paper-item-${blocker.slotQuestionNo}`}
                  className="underline hover:text-red-900"
                >
                  第 {blocker.slotQuestionNo} 题
                </a>
                ：{blocker.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* B1-UI: review warnings lifted to top (DRAFT state only) */}
      {paper.status !== "READY" && reviewWarnings.length > 0 && (
        <div
          className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="review-warnings"
        >
          <p className="font-medium">建议人工核对（{reviewWarnings.length}）</p>
          <ul className="mt-2 space-y-1">
            {reviewWarnings.map((warning, index) => (
              <li key={`${warning.slotQuestionNo}-${warning.code}-${index}`}>
                <a
                  href={`#paper-item-${warning.slotQuestionNo}`}
                  className="underline hover:text-amber-900"
                >
                  第 {warning.slotQuestionNo} 题
                </a>
                ：{warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

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
              disabled={markReadyDisabled}
              onClick={() => markReady.mutate({ paperId })}
              title={reviewBlockers.length > 0 ? "自动审题存在必须修正的问题，不能确认完成" : undefined}
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disabled ? "已确认完成" : "确认完成"}
            </button>
          </div>
        </div>
      </section>

      <PaperSpecTable specTable={query.data.specTable} />

      {params.styleTemplate && (
        <section
          className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200"
          data-testid="zhongkao-blueprint"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{ZHONGKAO_TEMPLATE_LABEL}</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {params.styleTemplate}
            </span>
            {params.blueprint?.isTopical ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                专题练习卷
              </span>
            ) : null}
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-600">
              命题结构（{params.blueprint?.slots.length ?? 0} 题）
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b">
                    <th className="whitespace-nowrap py-2 pr-3 font-medium">题号</th>
                    <th className="whitespace-nowrap py-2 pr-3 font-medium">题型</th>
                    <th className="whitespace-nowrap py-2 pr-3 font-medium">分值</th>
                    <th className="whitespace-nowrap py-2 pr-3 font-medium">难度</th>
                    <th className="whitespace-nowrap py-2 pr-3 font-medium">能力</th>
                    <th className="py-2 pr-3 font-medium">命题意图</th>
                    <th className="py-2 font-medium">知识点</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(params.blueprint?.slots ?? []).map((slot) => (
                    <tr key={slot.questionNo}>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {slot.questionNo}
                        {slot.isCapstone ? " ★" : ""}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{questionTypeLabel(slot.questionType as QuestionTypeValue)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{slot.points}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{slot.difficulty}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{cognitiveLevelLabel(slot.cognitiveLevel as CognitiveLevelValue)}</td>
                      <td className="py-2 pr-3">{slot.intent}</td>
                      <td className="py-2">{slot.kpNames.join("、")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {/* Warnings are now shown at the top of the page; not repeated here */}
        </section>
      )}

      <section className="space-y-4">
        {paper.items.map((item) => (
          <PaperItemCard
            key={item.id}
            paperId={paper.id}
            item={item}
            disabled={disabled}
            hasWarning={warnedPositions.has(item.position)}
            hasBlocker={blockedPositions.has(item.position)}
            figure={params.figures?.[String(item.position)] ?? null}
          />
        ))}
        {paper.items.length === 0 ? (
          <StatePanel title="试卷暂无题目" description="可以返回列表重新生成一份试卷。" />
        ) : null}
      </section>
    </div>
  );
}
