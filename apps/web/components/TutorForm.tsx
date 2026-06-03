"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { copyForReason } from "@/lib/error-copy";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_root";
import { ErrorAnalysisCard } from "@/app/(student)/tutor/error-analysis-card";

type TutorAskResult = inferRouterOutputs<AppRouter>["tutor"]["ask"];
type TutorAskImageResult = inferRouterOutputs<AppRouter>["tutor"]["askImage"];

const demoQuestion =
  "已知一次函数 y = 2x - 3 的图像与 x 轴交于点 A。求点 A 的坐标，并说明这个交点和方程 2x - 3 = 0 的关系。";

export function TutorForm({ demo = false }: { demo?: boolean }) {
  const [questionStem, setQ] = useState(demo ? demoQuestion : "");
  const [grade, setGrade] = useState<"G5"|"G6"|"G7"|"G8"|"G9"|"G10"|"G11"|"G12">("G8");
  const [actualAnswer, setActualAnswer] = useState("");
  const [showActualAnswer, setShowActualAnswer] = useState(false);
  // Snapshot the actualAnswer at submit time so editing the textarea after
  // submission does not retroactively change what gets sent to error.diagnose.
  const [diagnoseActualAnswer, setDiagnoseActualAnswer] = useState<string | undefined>();
  const [data, setData] = useState<TutorAskResult | null>(null);
  // Image (拍照答疑) result lives in its own state because its shape differs
  // from the text path (it carries stemTranscript, no modelCallId). The output
  // block + ErrorAnalysisCard render off the shared `view` below.
  const [imageData, setImageData] = useState<TutorAskImageResult | null>(null);
  // Editable copy of the AI transcript so the student can correct OCR slips and
  // re-ask via the cheaper text path.
  const [transcript, setTranscript] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  // Plan 3 Task 12: chargedProcedure idempotency key. Mint a fresh UUID per
  // "submit" click and stash it so a transient retry (e.g. ask.mutate triggered
  // twice by a double-click) reuses the same key — the second call hits
  // ACTION_IDEMPOTENCY_HIT and the user is not double-charged. Rotate the key
  // on every successful response and after a hard error.
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);

  const ask = trpc.tutor.ask.useMutation({
    onSuccess: (d) => {
      setData(d);
      setImageData(null);
      setDiagnoseActualAnswer(actualAnswer.trim() || undefined);
      setErr(null);
      setInsufficientBalance(false);
      setPendingReqId(null);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(copyForReason(reason));
      setData(null);
      setPendingReqId(null);
    },
  });

  const askImage = trpc.tutor.askImage.useMutation({
    onSuccess: (d) => {
      setImageData(d);
      setTranscript(d.stemTranscript);
      setData(null);
      // The image path carries no learner answer, so error analysis runs
      // without an actualAnswer (until the student re-asks by text).
      setDiagnoseActualAnswer(undefined);
      setErr(null);
      setInsufficientBalance(false);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(copyForReason(reason));
      setImageData(null);
    },
  });

  function submit() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    ask.mutate({ questionStem, studentGrade: grade, clientRequestId });
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setErr(null);
    setInsufficientBalance(false);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/uploads/tutor-image", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(copyForReason(body.error));
        return;
      }
      const { imageKey } = (await res.json()) as { imageKey: string };
      askImage.mutate({ imageKey, studentGrade: grade, clientRequestId: crypto.randomUUID() });
    } catch {
      setErr(copyForReason(undefined));
    } finally {
      setUploading(false);
    }
  }

  // Copy the (possibly hand-corrected) transcript into the stem and re-run the
  // 1-credit text path so the student pays vision price only once.
  function reaskFromTranscript() {
    setQ(transcript);
    const clientRequestId = crypto.randomUUID();
    setPendingReqId(clientRequestId);
    ask.mutate({ questionStem: transcript, studentGrade: grade, clientRequestId });
  }

  const view = data ?? imageData;
  const busy = ask.isPending || askImage.isPending || uploading;

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <select
        value={grade}
        onChange={(e) => setGrade(e.target.value as typeof grade)}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      >
        {(["G5","G6","G7","G8","G9","G10","G11","G12"] as const).map(g => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
      <textarea
        value={questionStem}
        onChange={(e) => setQ(e.target.value)}
        className="min-h-32 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
        placeholder="粘贴或输入题目"
        data-testid="tutor-input"
      />

      <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
        <label htmlFor="tutor-image-input" className="cursor-pointer text-slate-700">
          或拍照 / 上传题目图片（JPG / PNG / WebP，≤5MB）
        </label>
        <input
          id="tutor-image-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickImage}
          disabled={busy}
          className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="tutor-image-input"
        />
      </div>

      <details
        open={showActualAnswer}
        onToggle={(e) => setShowActualAnswer((e.target as HTMLDetailsElement).open)}
        className="rounded-lg border border-slate-200 p-3 text-sm"
      >
        <summary className="cursor-pointer text-slate-700">
          我的作答（可选，能让错因分析更准确）
        </summary>
        <textarea
          value={actualAnswer}
          onChange={(e) => setActualAnswer(e.target.value)}
          className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 p-3 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          placeholder="粘贴或输入你的作答"
          data-testid="tutor-actual-answer"
        />
      </details>

      <button
        disabled={busy || questionStem.trim().length === 0}
        onClick={submit}
        className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="tutor-submit"
      >
        {ask.isPending ? "讲解中..." : "讲一讲"}
      </button>

      {ask.isPending && <AiGeneratingPanel label="AI 讲解生成中…" />}
      {(uploading || askImage.isPending) && (
        <AiGeneratingPanel label="识别题目并讲解中…" />
      )}

      {err && (
        <p data-testid="tutor-error" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {err}
          {insufficientBalance ? (
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
          ) : (
            <>
              {" "}
              <button
                type="button"
                onClick={submit}
                className="underline"
                data-testid="tutor-retry"
              >
                重试
              </button>
            </>
          )}
        </p>
      )}

      {imageData && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-4">
          <label htmlFor="tutor-transcript" className="text-sm font-medium text-slate-700">
            题面转写（识别可能有误，可修改后按文本重新讲解）
          </label>
          <textarea
            id="tutor-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            data-testid="tutor-transcript"
          />
          <button
            type="button"
            disabled={busy || transcript.trim().length === 0}
            onClick={reaskFromTranscript}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="tutor-image-correct"
          >
            纠正题面，按文本重答
          </button>
        </div>
      )}

      {view && (
        <div data-testid="tutor-output" className="space-y-2 rounded-lg bg-slate-50 p-4">
          <h2 className="font-bold">{view.restatement}</h2>
          <ul className="list-disc pl-6">
            {view.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <p><strong>答案：</strong>{view.finalAnswer}</p>
        </div>
      )}

      {view && (
        // key={view.questionId} forces a full remount when the student submits
        // a different question. Without it, switching from question A to B
        // keeps the previously-rendered A analysis (and its A entry link) on
        // screen because component state survives a prop change.
        <ErrorAnalysisCard
          key={view.questionId}
          questionId={view.questionId}
          actualAnswerMd={diagnoseActualAnswer}
        />
      )}
    </div>
  );
}
