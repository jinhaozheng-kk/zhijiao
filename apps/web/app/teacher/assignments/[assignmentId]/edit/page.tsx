import Link from "next/link";
import { prisma } from "@zhijiao/db";
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="text-sm">
        <Link
          href={`/teacher/classes/${assignment.classroomId}`}
          className="text-slate-500 hover:underline"
        >
          Back to class
        </Link>
      </div>
      <div className="mt-4">
        <h1 className="text-2xl font-semibold">Edit Draft</h1>
        <p className="mt-1 text-sm text-slate-600">
          {assignment.classroom.name} · {assignment.status}
        </p>
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
    </main>
  );
}
