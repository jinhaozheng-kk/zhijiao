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
    <section className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">批改</h2>
      </div>
      <div className="divide-y">
        {answers.map((answer) => (
          <GradingRow key={answer.id} answer={answer} />
        ))}
        {answers.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-600">
            还没有提交的作答。
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
    onError: () => setError("作业状态已变化，请刷新后再继续。"),
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
          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() =>
            mutation.mutate({
              answerId: answer.id,
              gradeStatus,
              rootCause: needsRootCause ? rootCause : undefined,
              teacherFeedbackMd: teacherFeedbackMd || undefined,
            })
          }
        >
          {mutation.isPending ? "保存中..." : "保存批改"}
        </button>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <p>
          <span className="text-slate-500">题目：</span> {answer.itemStemMd}
        </p>
        <p>
          <span className="text-slate-500">参考：</span>{" "}
          {answer.itemAnswerMd}
        </p>
        <p>
          <span className="text-slate-500">作答：</span>{" "}
          {answer.answerJsonText}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          批改结果
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={gradeStatus}
            onChange={(e) =>
              setGradeStatus(
                e.target.value as Exclude<GradeStatus, "UNGRADED">,
              )
            }
          >
            <option value="CORRECT">正确</option>
            <option value="PARTIAL">部分正确</option>
            <option value="WRONG">错误</option>
          </select>
        </label>
        <label className="text-sm">
          错因
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
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
          反馈
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={teacherFeedbackMd}
            onChange={(e) => setTeacherFeedbackMd(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </article>
  );
}
