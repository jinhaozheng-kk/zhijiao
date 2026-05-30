import { StudentPortrait } from "./student-portrait";

export default function TeacherStudentPage({ params }: { params: { studentId: string } }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">学生学情</h1>
      <div className="mt-6">
        <StudentPortrait studentId={params.studentId} />
      </div>
    </main>
  );
}
