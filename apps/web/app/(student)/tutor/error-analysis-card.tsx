"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

const ROOT_CAUSE_LABEL: Record<string, string> = {
  CONCEPT_CONFUSION: "概念混淆",
  READING_ERROR: "读题失误",
  FORMULA_MISUSE: "公式误用",
  CALCULATION_SLIP: "计算疏漏",
  TRANSFER_GAP: "迁移不足",
  OTHER: "其它",
};

interface ErrorAnalysisCardProps {
  questionId: string;
  actualAnswerMd?: string;
}

// Plan 4 spec §5.1.1 / UI Reback A:
//   error.diagnose returns `entryId`; this card MUST render a deep link to
//   /error-book/[entryId] after a successful diagnose so the student can
//   continue into 错题本 → 举一反三 → 复习 from the analysis surface.
//
// Note on wiring: TutorForm currently submits a free-text stem to tutor.ask,
// which does NOT return a questionId. Mounting this card inside that flow
// requires either persisting tutor questions back to the question bank or a
// separate "answer an existing question" flow — both out of Plan 4 scope.
// This component is the building block; the call site lands in a later plan.
export function ErrorAnalysisCard({
  questionId,
  actualAnswerMd,
}: ErrorAnalysisCardProps) {
  const [analysis, setAnalysis] = useState<{
    entryId: string;
    rootCause: string;
    rootCauseReasoning: string;
    suggestedKnowledgePoints: string[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  // Same idemKey discipline as TutorForm: stash the cri so a double-click
  // reuses it (ACTION_IDEMPOTENCY_HIT; no double charge), but a deliberate
  // retry after error rotates to a fresh request.
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);

  const diagnose = trpc.error.diagnose.useMutation({
    onSuccess: (d) => {
      setAnalysis({
        entryId: d.entryId,
        rootCause: d.rootCause,
        rootCauseReasoning: d.rootCauseReasoning,
        suggestedKnowledgePoints: d.suggestedKnowledgePoints,
      });
      setErr(null);
      setInsufficientBalance(false);
      setPendingReqId(null);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(e.message);
      setPendingReqId(null);
    },
  });

  function onDiagnose() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    diagnose.mutate({
      questionId,
      ...(actualAnswerMd ? { actualAnswerMd } : {}),
      clientRequestId,
    });
  }

  if (!analysis) {
    return (
      <section
        className="rounded border border-amber-200 bg-amber-50 p-4"
        data-testid="error-analysis-card-empty"
      >
        <h3 className="font-semibold">这道题做错了？</h3>
        <p className="mt-1 text-sm text-slate-600">
          加入错题本并由 AI 分析错因（消耗 1 credit）。
        </p>
        <button
          type="button"
          onClick={onDiagnose}
          disabled={diagnose.isPending}
          className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          data-testid="btn-diagnose"
        >
          {diagnose.isPending ? "分析中…" : "加入错题本并分析错因"}
        </button>
        {err && (
          <p
            className="mt-2 text-sm text-red-600"
            data-testid="error-analysis-error"
          >
            {err}
            {insufficientBalance && (
              <>
                {" "}
                <Link
                  href="/wallet"
                  className="underline text-emerald-700"
                  data-testid="error-analysis-recharge-link"
                >
                  去充值
                </Link>
              </>
            )}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      className="rounded border border-amber-200 bg-amber-50 p-4"
      data-testid="error-analysis-card-result"
    >
      <h3 className="font-semibold">错因分析</h3>
      <div className="mt-2 text-sm">
        <span className="font-medium">分类：</span>
        {ROOT_CAUSE_LABEL[analysis.rootCause] ?? analysis.rootCause}
      </div>
      <div
        className="mt-2 whitespace-pre-wrap text-sm"
        data-testid="error-analysis-reasoning"
      >
        {analysis.rootCauseReasoning}
      </div>
      {analysis.suggestedKnowledgePoints.length > 0 && (
        <div className="mt-2 text-xs text-slate-600">
          相关知识点：{analysis.suggestedKnowledgePoints.join(" · ")}
        </div>
      )}
      <Link
        href={`/error-book/${analysis.entryId}`}
        className="mt-3 inline-block text-sm text-emerald-700 underline"
        data-testid="error-analysis-entry-link"
      >
        查看错题详情 →
      </Link>
    </section>
  );
}
