import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { GradingPanel } from "./grading-panel";

export const dynamic = "force-dynamic";

export default async function AssignmentDetailPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  const assignment = await prisma.assignment.findUniqueOrThrow({
    where: { id: params.assignmentId },
    include: {
      classroom: true,
      tiers: {
        orderBy: { createdAt: "asc" },
        include: { items: { orderBy: { position: "asc" } } },
      },
      studentAssignments: {
        orderBy: { createdAt: "asc" },
        include: {
          student: true,
          answers: {
            orderBy: { id: "asc" },
            include: { item: true },
          },
        },
      },
    },
  });
  const answers = assignment.studentAssignments.flatMap((studentAssignment) =>
    studentAssignment.answers.map((answer) => ({
      id: answer.id,
      studentName:
        studentAssignment.student.name ?? studentAssignment.studentUserId,
      studentAssignmentStatus: studentAssignment.status,
      itemStemMd: answer.item.stemMd,
      itemAnswerMd: answer.item.answerMd,
      answerJsonText: JSON.stringify(answer.answerJson),
      gradeStatus: answer.gradeStatus,
      teacherFeedbackMd: answer.teacherFeedbackMd ?? "",
    })),
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="text-sm">
        <Link
          href={`/teacher/classes/${assignment.classroomId}`}
          className="text-slate-500 hover:underline"
        >
          Back to class
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{assignment.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {assignment.classroom.name} · {assignment.status}
          </p>
        </div>
        {assignment.status === "DRAFT" && (
          <Link
            href={`/teacher/assignments/${assignment.id}/edit`}
            className="rounded border px-4 py-2 text-sm"
          >
            Edit Draft
          </Link>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <section className="rounded border bg-white p-4">
            <h2 className="font-medium">Summary</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Tiers</dt>
                <dd>{assignment.tiers.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Students</dt>
                <dd>{assignment.studentAssignments.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Answers</dt>
                <dd>{answers.length}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="font-medium">Tier Snapshot</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {assignment.tiers.map((tier) => (
                <li key={tier.id}>
                  {tier.level}: {tier.items.length} items
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <GradingPanel answers={answers} />
      </div>
    </main>
  );
}
