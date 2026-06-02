"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { assignmentTierLabel, studentAssignmentStatusLabel } from "@/lib/assignment-copy";
import { trpc } from "@/lib/trpc-client";

export function SubmitForm({
  studentAssignmentId,
}: {
  studentAssignmentId: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const query = trpc.assignment.getForStudent.useQuery(
    { studentAssignmentId },
    { retry: false },
  );
  const mutation = trpc.assignment.submit.useMutation({
    onSuccess: () => {
      setError(null);
      router.push(`/assignments/${studentAssignmentId}/result`);
    },
    onError: (e) => setError(e.message),
  });

  if (query.isLoading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-red-600">
        读取作业失败：{query.error.message}
      </p>
    );
  }
  if (!query.data) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  const studentAssignment = query.data.studentAssignment;
  const items = studentAssignment.tier.items;
  const alreadySubmitted = studentAssignment.status !== "ASSIGNED";

  return (
    <div>
      <div className="text-sm">
        <Link href="/assignments" className="text-slate-500 hover:underline">
          返回作业
        </Link>
      </div>
      <div className="mt-4">
        <h1 className="text-2xl font-semibold">
          {studentAssignment.assignment.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {studentAssignmentStatusLabel(studentAssignment.status)} ·{" "}
          {assignmentTierLabel(studentAssignment.tier.level)}
        </p>
      </div>

      {alreadySubmitted ? (
        <section className="mt-6 rounded border bg-white p-4">
          <p className="text-sm text-slate-700">
            这份作业已经提交。
          </p>
          <Link
            href={`/assignments/${studentAssignmentId}/result`}
            className="mt-3 inline-block rounded border px-3 py-2 text-sm"
          >
            查看结果
          </Link>
        </section>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate({
              studentAssignmentId,
              answers: items.map((item) => ({
                itemId: item.id,
                answerJson: { text: answers[item.id] ?? "" },
              })),
            });
          }}
        >
          {items.map((item, index) => (
            <section key={item.id} className="rounded border bg-white p-4">
              <h2 className="font-medium">第 {index + 1} 题</h2>
              <div className="mt-2 whitespace-pre-wrap text-sm">
                {item.stemMd}
              </div>
              <textarea
                className="mt-3 min-h-24 w-full rounded border px-3 py-2 text-sm"
                value={answers[item.id] ?? ""}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [item.id]: event.target.value,
                  }))
                }
              />
            </section>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "提交中..." : "提交作业"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
