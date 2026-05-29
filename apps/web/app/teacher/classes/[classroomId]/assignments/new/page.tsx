import Link from "next/link";
import { prisma } from "@zhijiao/db";
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="text-sm">
        <Link
          href={`/teacher/classes/${classroom.id}`}
          className="text-slate-500 hover:underline"
        >
          Back to class
        </Link>
      </div>
      <div className="mt-4">
        <h1 className="text-2xl font-semibold">Generate Tiered Assignment</h1>
        <p className="mt-1 text-sm text-slate-600">
          {classroom.name} · {classroom.subject.name}
        </p>
      </div>
      {firstKp ? (
        <GenerationForm
          classroomId={classroom.id}
          subjectId={classroom.subjectId}
          defaultKpId={firstKp.id}
        />
      ) : (
        <section className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This subject has no knowledge points yet.
        </section>
      )}
    </main>
  );
}
