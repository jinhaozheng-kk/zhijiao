import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { DraftEditor } from "./draft-editor";

export const dynamic = "force-dynamic";

export default async function AssignmentEditPage({
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
    },
  });

  return (
    <AppShell>
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
          eyebrow="作业草稿"
          title="审核分层作业"
          description={`${assignment.classroom.name} · ${assignment.status}`}
        />
      </div>
      <DraftEditor
        assignmentId={assignment.id}
        initialTitle={assignment.title}
        status={assignment.status}
        tiers={assignment.tiers.map((tier) => ({
          id: tier.id,
          level: tier.level,
          title: tier.title,
          rationaleMd: tier.rationaleMd,
          items: tier.items.map((item) => ({
            id: item.id,
            position: item.position,
            stemMd: item.stemMd,
            type: item.type,
            answerMd: item.answerMd,
            solutionMd: item.solutionMd,
          })),
        }))} 
      />
    </AppShell>
  );
}
