"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";
import {
  GRADE_LEVELS,
  gradeLevelLabel,
  type GradeLevel,
} from "@/lib/paper-copy";

type KpOption = { id: string; name: string };

export function CoursewareGenerationForm({
  subjectId,
  kps,
}: {
  subjectId: string;
  kps: KpOption[];
}) {
  const router = useRouter();
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>("G8");
  const [selectedKpIds, setSelectedKpIds] = useState<string[]>(
    kps.slice(0, 1).map((k) => k.id),
  );
  const [teachingGoal, setTeachingGoal] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.courseware.generate.useMutation({
    onSuccess: (result) => {
      router.push(`/teacher/coursewares/${result.coursewareId}`);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      if (reason === "INSUFFICIENT_BALANCE") {
        setError("Credits 余额不足，请先充值后再生成课件。");
      } else if (reason === "COMPLIANCE_REJECTED") {
        setError("生成内容未通过合规检查，请调整参数重试。");
      } else if (reason === "KP_SUBJECT_MISMATCH") {
        setError("选择的知识点与学科不匹配，请刷新后重试。");
      } else {
        setError("课件生成失败，请稍后再试。");
      }
    },
  });

  function toggleKp(id: string) {
    setSelectedKpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const canSubmit = !generate.isPending && selectedKpIds.length > 0;

  function submit() {
    setError(null);
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      teachingGoal: teachingGoal.trim() ? teachingGoal.trim() : undefined,
      clientRequestId: crypto.randomUUID(),
    });
  }

  return (
    <section className="mt-6 space-y-6 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {/* 年级 */}
      <div>
        <label className="block text-sm font-medium text-slate-700">年级</label>
        <select
          value={gradeLevel}
          onChange={(e) => setGradeLevel(e.target.value as GradeLevel)}
          className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          data-testid="grade-select"
        >
          {GRADE_LEVELS.map((g) => (
            <option key={g} value={g}>
              {gradeLevelLabel(g)}
            </option>
          ))}
        </select>
      </div>

      {/* 知识点 */}
      <div>
        <p className="text-sm font-medium text-slate-700">知识点（至少选 1 个）</p>
        <div className="mt-2 flex flex-wrap gap-2" data-testid="kp-picker">
          {kps.map((kp) => {
            const selected = selectedKpIds.includes(kp.id);
            return (
              <button
                key={kp.id}
                type="button"
                onClick={() => toggleKp(kp.id)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
                data-testid={`kp-${kp.id}`}
              >
                {kp.name}
              </button>
            );
          })}
        </div>
        {selectedKpIds.length === 0 && (
          <p className="mt-1 text-xs text-red-600">请至少选一个知识点。</p>
        )}
      </div>

      {/* 教学目标（可选） */}
      <div>
        <label className="block text-sm font-medium text-slate-700">
          教学目标（可选）
        </label>
        <textarea
          value={teachingGoal}
          onChange={(e) => setTeachingGoal(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="例如：让学生理解一次函数的图象与性质，并能解决简单实际问题。"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          data-testid="goal-input"
        />
      </div>

      {/* Credits 提示 */}
      <p className="text-sm text-slate-500">生成课件消耗 3 credits。</p>

      {/* 生成中面板 */}
      {generate.isPending && <AiGeneratingPanel label="AI 生成课件中，请稍候…" />}

      {/* 错误与重试 */}
      {error && (
        <p
          className="rounded-lg bg-red-50 p-4 text-sm text-red-700"
          data-testid="generate-error"
        >
          {error}{" "}
          <button
            type="button"
            onClick={submit}
            className="underline"
            data-testid="generate-retry"
          >
            重试
          </button>
        </p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="generate-submit"
      >
        {generate.isPending ? "生成中…" : "生成课件"}
      </button>
    </section>
  );
}
