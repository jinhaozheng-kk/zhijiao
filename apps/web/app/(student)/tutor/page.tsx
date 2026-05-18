import { TutorForm } from "@/components/TutorForm";

export default function TutorPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">AI 答疑</h1>
      <p className="mt-1 text-sm text-slate-600">
        粘贴或输入一道题，AI 会先讲思路，再展开完整答案。
      </p>
      <div className="mt-8">
        <TutorForm />
      </div>
    </main>
  );
}
