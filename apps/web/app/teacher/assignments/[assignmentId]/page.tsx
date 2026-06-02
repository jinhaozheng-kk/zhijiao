import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";
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
    <AppShell role="TEACHER" demoMode={isDemoModeEnabled()}>
      <div className="text-sm">
        <Link
          href={`/teacher/classes/${assignment.classroomId}`}
          className="text-slate-500 hover:underline"
        >
          返回班级
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader
          eyebrow="作业批改"
          title={assignment.title}
          description={`${assignment.classroom.name} · ${assignment.status}`}
          action={
            assignment.status === "DRAFT" ? (
              <Link
                href={`/teacher/assignments/${assignment.id}/edit`}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium"
              >
                编辑草稿
              </Link>
            ) : null
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-medium">概览</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">层级</dt>
                <dd>{assignment.tiers.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">学生</dt>
                <dd>{assignment.studentAssignments.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">作答</dt>
                <dd>{answers.length}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-medium">分层快照</h2>
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
    </AppShell>
  );
}
