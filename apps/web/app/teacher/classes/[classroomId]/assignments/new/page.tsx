import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { GenerationForm } from "./generation-form";

export const dynamic = "force-dynamic";

export default async function NewAssignmentPage({
  params,
}: {
  params: { classroomId: string };
}) {
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: params.classroomId },
    include: { subject: { include: { knowledgePoints: true } } },
  });
  const firstKp = classroom.subject.knowledgePoints[0];
  const className = classroom.id.startsWith("demo-") ? "初二 3 班" : classroom.name;

  return (
    <AppShell>
      <div className="text-sm">
        <Link
          href={`/teacher/classes/${classroom.id}`}
          className="text-slate-500 hover:underline"
        >
          返回班级
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader
          eyebrow="分层作业"
          title="生成分层作业"
          description={`${className} · ${classroom.subject.name}`}
        />
      </div>
      {firstKp ? (
        <GenerationForm
          classroomId={classroom.id}
          subjectId={classroom.subjectId}
          defaultKpId={firstKp.id}
        />
      ) : (
        <div className="mt-6">
          <StatePanel title="还没有知识点" description="当前学科还没有可用于生成作业的知识点。" />
        </div>
      )}
    </AppShell>
  );
}
