import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { assignmentStatusLabel } from "@/lib/assignment-copy";
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
  const className = classroom.id.startsWith("demo-") ? "初二 3 班" : classroom.name;

  return (
    <AppShell>
      <div className="text-sm">
        <Link href="/teacher" className="text-slate-500 hover:underline">
          返回教师工作台
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader
          eyebrow="班级诊断"
          title={className}
          description={`${classroom.subject.name} · ${students.length} 名学生`}
          action={
            <Link
              href={`/teacher/classes/${classroom.id}/assignments/new`}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              生成分层作业
            </Link>
          }
        />
      </div>

      <section className="mt-6 rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-medium">班级学情诊断</h2>
        <p className="mt-1 text-sm text-slate-600">基于近 90 天作业批改的知识点掌握分布，蓝色为建议优先讲评方向。</p>
        <div className="mt-3">
          <ClassDiagnosis classroomId={classroom.id} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section id="assignments" className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">分层作业</h2>
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
                    {assignmentStatusLabel(assignment.status)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {assignment.status === "DRAFT" && (
                    <Link
                      href={`/teacher/assignments/${assignment.id}/edit`}
                      className="rounded border px-3 py-2 text-sm"
                    >
                      编辑
                    </Link>
                  )}
                  <Link
                    href={`/teacher/assignments/${assignment.id}`}
                    className="rounded border px-3 py-2 text-sm"
                  >
                    查看
                  </Link>
                </div>
              </div>
            ))}
            {classroom.assignments.length === 0 && (
              <div className="p-4">
                <StatePanel title="还没有作业" description="从班级薄弱点生成一份分层作业。" />
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-medium">知识点</h2>
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
          <section id="ai-paper" className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-medium text-emerald-700">已上线</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">AI 出卷</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              按年级、知识点、题型、难度和题量生成练习卷，并带答案解析与双向细目表。
            </p>
            <Link
              href="/teacher/papers"
              className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              去出卷
            </Link>
          </section>
          <section id="ai-courseware" className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-medium text-emerald-700">已上线</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">AI 课件</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              按年级与知识点生成课堂导入、讲解结构、例题、易错点和课堂练习五段课件。
            </p>
            <Link
              href="/teacher/coursewares"
              className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              去做课件
            </Link>
          </section>
          <section id="students" className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-medium">学生</h2>
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
    </AppShell>
  );
}
