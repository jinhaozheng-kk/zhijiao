import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { ClassDiagnosis } from "./class-diagnosis";

export const dynamic = "force-dynamic";

export default async function TeacherClassPage({
  params,
}: {
  params: { classroomId: string };
}) {
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: params.classroomId },
    include: {
      subject: { include: { knowledgePoints: { orderBy: { name: "asc" } } } },
      members: { include: { user: true }, orderBy: { createdAt: "asc" } },
      assignments: { orderBy: { createdAt: "desc" } },
    },
  });
  const students = classroom.members.filter(
    (member) => member.role === "STUDENT",
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="text-sm">
        <Link href="/teacher" className="text-slate-500 hover:underline">
          Back to workspace
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{classroom.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {classroom.subject.name} · {students.length} students
          </p>
        </div>
        <Link
          href={`/teacher/classes/${classroom.id}/assignments/new`}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Generate Assignment
        </Link>
      </div>

      <section className="mt-6 rounded border bg-white p-4">
        <h2 className="font-medium">班级学情诊断</h2>
        <p className="mt-1 text-sm text-slate-600">基于近 90 天作业批改的知识点掌握分布，蓝色为建议优先讲评方向。</p>
        <div className="mt-3">
          <ClassDiagnosis classroomId={classroom.id} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="overflow-hidden rounded border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">Assignments</h2>
          </div>
          <div className="divide-y">
            {classroom.assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <h3 className="font-medium">{assignment.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {assignment.status} · {assignment.source}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {assignment.status === "DRAFT" && (
                    <Link
                      href={`/teacher/assignments/${assignment.id}/edit`}
                      className="rounded border px-3 py-2 text-sm"
                    >
                      Edit
                    </Link>
                  )}
                  <Link
                    href={`/teacher/assignments/${assignment.id}`}
                    className="rounded border px-3 py-2 text-sm"
                  >
                    Detail
                  </Link>
                </div>
              </div>
            ))}
            {classroom.assignments.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-600">
                No assignments have been created yet.
              </p>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded border bg-white p-4">
            <h2 className="font-medium">Knowledge Points</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {classroom.subject.knowledgePoints.slice(0, 12).map((kp) => (
                <span
                  key={kp.id}
                  className="rounded border px-2 py-1 text-xs text-slate-700"
                >
                  {kp.name}
                </span>
              ))}
            </div>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="font-medium">Students</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {students.slice(0, 10).map((member) => (
                <li key={member.userId}>
                  <Link
                    href={`/teacher/students/${member.userId}`}
                    className="text-emerald-700 hover:underline"
                  >
                    {member.user.name ?? member.userId}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
