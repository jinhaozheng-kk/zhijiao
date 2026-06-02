"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function GenerationForm({
  classroomId,
  subjectId,
  defaultKpId,
}: {
  classroomId: string;
  subjectId: string;
  defaultKpId: string;
}) {
  const router = useRouter();
  const [basic, setBasic] = useState(2);
  const [consolidation, setConsolidation] = useState(2);
  const [challenge, setChallenge] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const total = basic + consolidation + challenge;
  const mutation = trpc.assignment.generateDraftFromCriteria.useMutation({
    onSuccess: (result) => {
      router.push(`/teacher/assignments/${result.assignmentId}/edit`);
    },
    onError: () => setError("作业状态已变化，请刷新后再继续。"),
  });
  const disabled = mutation.isPending || total <= 0 || total > 30;

  return (
    <section className="mt-6 rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">生成条件</h2>
          <p className="mt-1 text-sm text-slate-600">
            草稿需要教师确认后再发布。按生成题量扣除 credits。
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2 text-sm">
          {total} credits
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <TierCountInput label="基础" value={basic} onChange={setBasic} />
        <TierCountInput
          label="巩固"
          value={consolidation}
          onChange={setConsolidation}
        />
        <TierCountInput
          label="提升"
          value={challenge}
          onChange={setChallenge}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            setError(null);
            mutation.mutate({
              classroomId,
              clientRequestId: crypto.randomUUID(),
              subjectId,
              gradeLevel: "G8",
              kpIds: [defaultKpId],
              difficultyRange: [2, 4],
              tierCounts: {
                BASIC: basic,
                CONSOLIDATION: consolidation,
                CHALLENGE: challenge,
              },
              questionTypes: ["SINGLE_CHOICE", "CALCULATION"],
            });
          }}
        >
          {mutation.isPending ? "生成中..." : "生成草稿"}
        </button>
        {total > 30 && (
          <p className="text-sm text-red-600">最多 30 道题。</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}

function TierCountInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
        type="number"
        min={0}
        max={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
