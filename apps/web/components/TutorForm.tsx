"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { TutoringOutput } from "@zhijiao/ai";

export function TutorForm() {
  const [questionStem, setQ] = useState("");
  const [grade, setGrade] = useState<"G5"|"G6"|"G7"|"G8"|"G9"|"G10"|"G11"|"G12">("G8");
  const [data, setData] = useState<TutoringOutput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Distinguish INSUFFICIENT_BALANCE from other failures so the CTA can
  // deep-link straight to /wallet rather than asking the user to figure out
  // the recharge path themselves.
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  // Plan 3 Task 12: chargedProcedure idempotency key. We mint a fresh
  // UUID per "submit" click and stash it so a transient retry (e.g.
  // ask.mutate triggered twice by a double-click) reuses the same key —
  // the second call hits ACTION_IDEMPOTENCY_HIT and the user is not
  // double-charged. We rotate the key on every successful response and
  // also after a hard error so the next attempt is a new request.
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);

  const ask = trpc.tutor.ask.useMutation({
    onSuccess: (d) => {
      setData(d);
      setErr(null);
      setInsufficientBalance(false);
      setPendingReqId(null);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(e.message);
      setData(null);
      setPendingReqId(null);
    },
  });

  function submit() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    ask.mutate({ questionStem, studentGrade: grade, clientRequestId });
  }

  return (
    <div className="space-y-4">
      <select value={grade} onChange={(e) => setGrade(e.target.value as typeof grade)} className="border rounded px-2 py-1">
        {(["G5","G6","G7","G8","G9","G10","G11","G12"] as const).map(g => <option key={g} value={g}>{g}</option>)}
      </select>
      <textarea value={questionStem} onChange={(e) => setQ(e.target.value)} className="w-full border rounded p-2 min-h-32" placeholder="粘贴或输入题目" data-testid="tutor-input" />
      <button
        disabled={ask.isPending || questionStem.trim().length === 0}
        onClick={submit}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        data-testid="tutor-submit"
      >
        {ask.isPending ? "讲解中..." : "讲一讲"}
      </button>
      {err && (
        <p data-testid="tutor-error" className="text-red-600">
          {err}
          {insufficientBalance && (
            <>
              {" "}
              <Link
                href="/wallet"
                className="underline text-emerald-700"
                data-testid="tutor-error-recharge-link"
              >
                去充值
              </Link>
            </>
          )}
        </p>
      )}
      {data && (
        <div data-testid="tutor-output" className="space-y-2">
          <h2 className="font-bold">{data.restatement}</h2>
          <ul className="list-disc pl-6">{data.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <p><strong>答案：</strong>{data.finalAnswer}</p>
        </div>
      )}
    </div>
  );
}
