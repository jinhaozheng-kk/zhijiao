import { AssignmentList } from "./assignment-list";

export default function AssignmentsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">My Assignments</h1>
      <AssignmentList />
    </main>
  );
}
