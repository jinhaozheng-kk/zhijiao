"use client";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function AdviceCard({ window }: { window: "D30" | "D90" | "ALL" }) {
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const advise = trpc.analytics.profile.generateAdvice.useMutation({
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficient(reason === "INSUFFICIENT_BALANCE");
      setPendingReqId(null);
    },
    onSuccess: () => setPendingReqId(null),
  });

  function onGenerate() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    advise.mutate({ window, clientRequestId });
  }

  return (
    <section className="rounded border border-amber-200 bg-amber-50 p-4" data-testid="advice-card">
      <h3 className="font-semibold">AI 学习方法建议</h3>
      <p className="mt-1 text-sm text-slate-600">基于你的掌握情况，生成可执行的学习方法（消耗 1 credit）。</p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={advise.isPending}
        className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        data-testid="btn-generate-advice"
      >
        {advise.isPending ? "生成中…" : "生成学习建议"}
      </button>
      {advise.error && (
        <p className="mt-2 text-sm text-red-600" data-testid="advice-error">
          {advise.error.message}
          {insufficient && (
            <>
              {" "}
              <Link href="/wallet" className="underline text-emerald-700">去充值</Link>
            </>
          )}
        </p>
      )}
      {advise.data && (
        <div className="mt-3 space-y-2 text-sm" data-testid="advice-result">
          <p className="whitespace-pre-wrap">{advise.data.summaryMd}</p>
          <ul className="list-disc pl-5">
            {advise.data.suggestions.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.focusKp}：</span>
                {s.methodMd}
              </li>
            ))}
          </ul>
          <p className="text-slate-600">{advise.data.encouragementMd}</p>
        </div>
      )}
    </section>
  );
}
