"use client";

import Link from "next/link";
import { useState } from "react";
import { copyForReason } from "@/lib/error-copy";
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

interface AnalysisView {
  entryId: string;
  rootCause: string;
  rootCauseReasoning: string;
  suggestedKnowledgePoints: string[];
}

// Plan 4 spec §5.1.1 / UI Reback A:
//   error.diagnose returns `entryId`; this card MUST render a deep link to
//   /error-book/[entryId] after a successful diagnose so the student can
//   continue into 错题本 → 举一反三 → 复习 from the analysis surface.
//
// Plan 8 wiring: TutorForm now mounts this card with the questionId returned
// by tutor.ask. TutorForm passes key={data.questionId} so a different
// questionId fully remounts (state reset) — local state below does not need
// a useEffect to clear on prop change.
//
// Plan 8 hotfix (P2 from review): on mount, query error.findEntryForQuestion
// to detect an already-existing ACTIVE/ARCHIVED entry for this question.
// Without this, every page revisit of the same question shows the paid CTA
// and clicking it would re-charge ERROR_ANALYSIS + re-call AI even though
// the backend would just dedupe the entry — pure waste.
//
// Display priority: post-diagnose result > existing-entry seed > CTA.
// suggestedKnowledgePoints is NOT persisted on ErrorBookEntry (it's only
// produced by the AI on diagnose), so when seeded from an existing entry
// we render `[]` and the "相关知识点" row hides via the .length === 0 guard.
export function ErrorAnalysisCard({
  questionId,
  actualAnswerMd,
}: ErrorAnalysisCardProps) {
  const [postDiagnose, setPostDiagnose] = useState<AnalysisView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  // Same idemKey discipline as TutorForm: stash the cri so a double-click
  // reuses it (ACTION_IDEMPOTENCY_HIT; no double charge), but a deliberate
  // retry after error rotates to a fresh request.
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);

  // Mount-time read for pre-existing entry. Disable once we have the answer
  // so the query doesn't refetch on focus / interval and overwrite a fresh
  // post-diagnose result. (postDiagnose takes priority anyway via the
  // derived `analysis` below, but disabling avoids stale-flash and chatter.)
  const existing = trpc.error.findEntryForQuestion.useQuery(
    { questionId },
    {
      enabled: postDiagnose === null,
      // questionId change remounts the whole component (TutorForm passes
      // key={questionId}), so no manual invalidation is needed here.
      refetchOnWindowFocus: false,
    },
  );

  const fromExisting: AnalysisView | null = existing.data?.entry
    ? {
        entryId: existing.data.entry.id,
        rootCause: existing.data.entry.rootCause,
        rootCauseReasoning: existing.data.entry.rootCauseReasoning,
        suggestedKnowledgePoints: [],
      }
    : null;
  const analysis: AnalysisView | null = postDiagnose ?? fromExisting;

  const diagnose = trpc.error.diagnose.useMutation({
    onSuccess: (d) => {
      setPostDiagnose({
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
      setErr(copyForReason(reason));
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
          disabled={diagnose.isPending || existing.isLoading}
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
