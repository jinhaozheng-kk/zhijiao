import { SubmitForm } from "./submit-form";

export default function AssignmentSubmitPage({
  params,
}: {
  params: { studentAssignmentId: string };
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <SubmitForm studentAssignmentId={params.studentAssignmentId} />
    </main>
  );
}
