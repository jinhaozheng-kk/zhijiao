"use client";

import Link from "next/link";
import { gradeStatusLabel, studentAssignmentStatusLabel } from "@/lib/assignment-copy";
import { trpc } from "@/lib/trpc-client";
import { MathText } from "@/components/math-text";

export default function AssignmentResultPage({
  params,
}: {
  params: { studentAssignmentId: string };
}) {
  const query = trpc.assignment.getForStudent.useQuery(
    { studentAssignmentId: params.studentAssignmentId },
    { retry: false },
  );

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-500">
        Loading...
      </main>
    );
  }
  if (query.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 text-sm text-red-600">
        Could not load result: {query.error.message}
      </main>
    );
  }
  if (!query.data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-500">
        Loading...
      </main>
    );
  }

  const studentAssignment = query.data.studentAssignment;
  const answersByItem = new Map(
    studentAssignment.answers.map((answer) => [answer.itemId, answer]),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
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
          {studentAssignmentStatusLabel(studentAssignment.status)}
        </p>
      </div>

      <section className="mt-6 space-y-4">
        {studentAssignment.tier.items.map((item, index) => {
          const answer = answersByItem.get(item.id);
          return (
            <article key={item.id} className="rounded border bg-white p-4">
              <div className="text-xs uppercase text-slate-500">
                第 {index + 1} 题 ·{" "}
                {gradeStatusLabel(answer?.gradeStatus ?? "UNGRADED")}
              </div>
              <h2 className="mt-1 font-medium">
                <MathText text={item.stemMd} />
              </h2>
              <p className="mt-3 text-sm text-slate-700">
                作答：{answer ? JSON.stringify(answer.answerJson) : "未作答"}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                参考：<MathText text={item.answerMd} />
              </p>
              {answer?.teacherFeedbackMd && (
                <p className="mt-1 text-sm text-slate-600">
                  反馈：{answer.teacherFeedbackMd}
                </p>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
