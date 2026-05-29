import Link from "next/link";
import { prisma } from "@zhijiao/db";

export const dynamic = "force-dynamic";

export default async function TeacherHome() {
  const classrooms = await prisma.classroom.findMany({
    include: {
      subject: true,
      members: true,
      assignments: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Teacher Workspace</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review class diagnostics, generate tiered assignments, and grade
            submitted work.
          </p>
        </div>
        {classrooms[0] && (
          <Link
            href={`/teacher/classes/${classrooms[0].id}/assignments/new`}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
          >
            New Assignment
          </Link>
        )}
      </div>

      <section className="mt-6 overflow-hidden rounded border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">Classes</h2>
        </div>
        <div className="divide-y">
          {classrooms.map((classroom) => {
            const studentCount = classroom.members.filter(
              (member) => member.role === "STUDENT",
            ).length;
            return (
              <div
                key={classroom.id}
                className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <h3 className="font-medium">{classroom.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {classroom.subject.name} · {studentCount} students ·{" "}
                    {classroom.assignments.length} recent assignments
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/teacher/classes/${classroom.id}`}
                    className="rounded border px-3 py-2 text-sm"
                  >
                    Open Class
                  </Link>
                  <Link
                    href={`/teacher/classes/${classroom.id}/assignments/new`}
                    className="rounded bg-emerald-700 px-3 py-2 text-sm text-white"
                  >
                    Generate
                  </Link>
                </div>
              </div>
            );
          })}
          {classrooms.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-600">
              No classrooms are available.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
