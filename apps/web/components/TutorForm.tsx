"use client";

import { useState, useTransition } from "react";
import { askTutor, type TutorActionResult } from "@/app/(student)/tutor/actions";

export function TutorForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TutorActionResult | null>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await askTutor(formData);
      setResult(r);
    });
  }

  return (
    <div className="space-y-6">
      <form action={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">题目</span>
          <textarea
            name="questionStem"
            required
            rows={5}
            placeholder="粘贴或输入题目..."
            className="mt-1 block w-full rounded-md border border-slate-300 p-2 font-mono"
            data-testid="input-stem"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">学段</span>
          <select
            name="studentGrade"
            defaultValue="G8"
            className="mt-1 block w-40 rounded-md border border-slate-300 p-2"
            data-testid="input-grade"
          >
            {(["G5","G6","G7","G8","G9","G10","G11","G12"] as const).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          data-testid="submit"
        >
          {pending ? "讲解中..." : "提问"}
        </button>
      </form>

      {result && !result.ok && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800" data-testid="error">
          {result.error}
        </div>
      )}

      {result && result.ok && (
        <article className="space-y-4 rounded-md border border-slate-200 bg-white p-4" data-testid="result">
          <Section title="题意重述">{result.data.restatement}</Section>
          <Section title="涉及知识点">
            <ul className="list-disc pl-5">
              {result.data.knowledgePoints.map((k, i) => (<li key={i}>{k}</li>))}
            </ul>
          </Section>
          <Section title="分步思路">
            <ol className="list-decimal pl-5 space-y-1">
              {result.data.steps.map((s, i) => (<li key={i}>{s}</li>))}
            </ol>
          </Section>
          {result.data.pitfalls.length > 0 && (
            <Section title="易错点">
              <ul className="list-disc pl-5">
                {result.data.pitfalls.map((p, i) => (<li key={i}>{p}</li>))}
              </ul>
            </Section>
          )}
          <details>
            <summary className="cursor-pointer font-medium text-slate-700" data-testid="reveal-answer">
              查看完整答案
            </summary>
            <div className="mt-2 rounded bg-slate-50 p-2 font-mono" data-testid="final-answer">
              {result.data.finalAnswer}
            </div>
          </details>
        </article>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <div className="mt-1 text-slate-700">{children}</div>
    </section>
  );
}
