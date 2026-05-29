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
    onError: (e) => setError(e.message),
  });
  const disabled = mutation.isPending || total <= 0 || total > 30;

  return (
    <section className="mt-6 rounded border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Generation Criteria</h2>
          <p className="mt-1 text-sm text-slate-600">
            Drafts must be reviewed before publishing. Cost is charged per
            generated question.
          </p>
        </div>
        <div className="rounded border px-3 py-2 text-sm">
          {total} credits
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <TierCountInput label="Basic" value={basic} onChange={setBasic} />
        <TierCountInput
          label="Consolidation"
          value={consolidation}
          onChange={setConsolidation}
        />
        <TierCountInput
          label="Challenge"
          value={challenge}
          onChange={setChallenge}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
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
          {mutation.isPending ? "Generating..." : "Generate Draft"}
        </button>
        {total > 30 && (
          <p className="text-sm text-red-600">Maximum 30 questions.</p>
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
        className="mt-1 w-full rounded border px-3 py-2"
        type="number"
        min={0}
        max={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
