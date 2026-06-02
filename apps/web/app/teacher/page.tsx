import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { ActionCard } from "@/components/ui/action-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { isDemoModeEnabled } from "@/server/demo/config";

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
    <AppShell role="TEACHER" demoMode={isDemoModeEnabled()}>
      <PageHeader
        eyebrow="教师教学"
        title="教师工作台"
        description="查看班级诊断，生成分层作业，并把批改结果回流到错题巩固。"
        action={
          classrooms[0] ? (
            <Link
              href={`/teacher/classes/${classrooms[0].id}/assignments/new`}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              生成分层作业
            </Link>
          ) : null
        }
      />

      {classrooms.length === 0 ? (
        <div className="mt-8">
          <StatePanel
            title="还没有班级"
            description="演示数据未准备好。请运行 pnpm demo:reset 后再进入教师体验。"
          />
        </div>
      ) : (
        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {classrooms.map((classroom) => {
            const studentCount = classroom.members.filter(
              (member) => member.role === "STUDENT",
            ).length;

            return (
              <ActionCard
                key={classroom.id}
                href={`/teacher/classes/${classroom.id}`}
                title={classroom.id.startsWith("demo-") ? "初二 3 班" : classroom.name}
                description={`${classroom.subject.name} · ${studentCount} 名学生 · ${classroom.assignments.length} 个近期作业`}
                label="打开班级"
              />
            );
          })}
        </section>
      )}
    </AppShell>
  );
}
