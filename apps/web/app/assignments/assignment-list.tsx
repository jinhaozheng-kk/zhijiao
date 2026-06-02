"use client";

import Link from "next/link";
import { assignmentTierLabel, studentAssignmentStatusLabel } from "@/lib/assignment-copy";
import { trpc } from "@/lib/trpc-client";

export function AssignmentList() {
  const query = trpc.assignment.listForStudent.useQuery(undefined, {
    retry: false,
  });

  if (query.isLoading) {
    return <p className="mt-4 text-sm text-slate-500">Loading...</p>;
  }
  if (query.isError) {
    return (
      <p className="mt-4 text-sm text-red-600">
        Could not load assignments: {query.error.message}
      </p>
    );
  }
  if (!query.data) {
    return <p className="mt-4 text-sm text-slate-500">Loading...</p>;
  }

  return (
    <section className="mt-6 overflow-hidden rounded border bg-white">
      <div className="divide-y">
        {query.data.assignments.map((studentAssignment) => (
          <div
            key={studentAssignment.id}
            className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto]"
          >
            <div>
              <h2 className="font-medium">
                {studentAssignment.assignment.title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {studentAssignment.assignment.classroom.name} ·{" "}
                {studentAssignmentStatusLabel(studentAssignment.status)} ·{" "}
                {assignmentTierLabel(studentAssignment.tier.level)}
              </p>
            </div>
            <Link
              href={
                studentAssignment.status === "GRADED"
                  ? `/assignments/${studentAssignment.id}/result`
                  : `/assignments/${studentAssignment.id}`
              }
              className="rounded border px-3 py-2 text-sm"
            >
              打开
            </Link>
          </div>
        ))}
        {query.data.assignments.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-600">
            暂无作业。
          </p>
        )}
      </div>
    </section>
  );
}
