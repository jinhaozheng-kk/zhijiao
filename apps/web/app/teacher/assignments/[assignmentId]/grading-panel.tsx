"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

const ROOT_CAUSES = [
  "CONCEPT_CONFUSION",
  "READING_ERROR",
  "FORMULA_MISUSE",
  "CALCULATION_SLIP",
  "TRANSFER_GAP",
  "OTHER",
] as const;

type GradeStatus = "UNGRADED" | "CORRECT" | "PARTIAL" | "WRONG";

interface GradingAnswer {
  id: string;
  studentName: string;
  studentAssignmentStatus: string;
  itemStemMd: string;
  itemAnswerMd: string;
  answerJsonText: string;
  gradeStatus: GradeStatus;
  teacherFeedbackMd: string;
}

export function GradingPanel({ answers }: { answers: GradingAnswer[] }) {
  return (
    <section className="overflow-hidden rounded border bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">Grading</h2>
      </div>
      <div className="divide-y">
        {answers.map((answer) => (
          <GradingRow key={answer.id} answer={answer} />
        ))}
        {answers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-600">
            No submitted answers yet.
          </p>
        )}
      </div>
    </section>
  );
}

function GradingRow({ answer }: { answer: GradingAnswer }) {
  const router = useRouter();
  const [gradeStatus, setGradeStatus] = useState<Exclude<
    GradeStatus,
    "UNGRADED"
  >>(answer.gradeStatus === "UNGRADED" ? "CORRECT" : answer.gradeStatus);
  const [rootCause, setRootCause] =
    useState<(typeof ROOT_CAUSES)[number]>("FORMULA_MISUSE");
  const [teacherFeedbackMd, setTeacherFeedbackMd] = useState(
    answer.teacherFeedbackMd,
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.assignment.gradeAnswer.useMutation({
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });
  const needsRootCause = gradeStatus === "PARTIAL" || gradeStatus === "WRONG";

  return (
    <article className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{answer.studentName}</div>
          <div className="mt-1 text-xs uppercase text-slate-500">
            {answer.studentAssignmentStatus} · {answer.gradeStatus}
          </div>
        </div>
        <button
          type="button"
          disabled={mutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          onClick={() =>
            mutation.mutate({
              answerId: answer.id,
              gradeStatus,
              rootCause: needsRootCause ? rootCause : undefined,
              teacherFeedbackMd: teacherFeedbackMd || undefined,
            })
          }
        >
          {mutation.isPending ? "Saving..." : "Save Grade"}
        </button>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <p>
          <span className="text-slate-500">Question:</span> {answer.itemStemMd}
        </p>
        <p>
          <span className="text-slate-500">Expected:</span>{" "}
          {answer.itemAnswerMd}
        </p>
        <p>
          <span className="text-slate-500">Submitted:</span>{" "}
          {answer.answerJsonText}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Grade
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={gradeStatus}
            onChange={(e) =>
              setGradeStatus(
                e.target.value as Exclude<GradeStatus, "UNGRADED">,
              )
            }
          >
            <option value="CORRECT">Correct</option>
            <option value="PARTIAL">Partial</option>
            <option value="WRONG">Wrong</option>
          </select>
        </label>
        <label className="text-sm">
          Root cause
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={rootCause}
            disabled={!needsRootCause}
            onChange={(e) =>
              setRootCause(e.target.value as (typeof ROOT_CAUSES)[number])
            }
          >
            {ROOT_CAUSES.map((cause) => (
              <option key={cause} value={cause}>
                {cause}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-1">
          Feedback
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={teacherFeedbackMd}
            onChange={(e) => setTeacherFeedbackMd(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </article>
  );
}
