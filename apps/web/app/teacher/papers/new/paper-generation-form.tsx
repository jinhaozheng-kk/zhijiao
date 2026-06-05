"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";
import {
  QUESTION_TYPES,
  GRADE_LEVELS,
  questionTypeLabel,
  gradeLevelLabel,
  type GradeLevel,
  type QuestionTypeValue,
} from "@/lib/paper-copy";

type KpOption = { id: string; name: string };

export function PaperGenerationForm({
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
  const [selectedTypes, setSelectedTypes] = useState<QuestionTypeValue[]>([
    "SINGLE_CHOICE",
    "CALCULATION",
  ]);
  const [diffMin, setDiffMin] = useState(2);
  const [diffMax, setDiffMax] = useState(4);
  const [count, setCount] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.paper.generate.useMutation({
    onSuccess: (result) => {
      router.push(`/teacher/papers/${result.paperId}`);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      if (reason === "INSUFFICIENT_BALANCE") {
        setError("Credits 余额不足，请先充值后再出卷。");
      } else if (reason === "COMPLIANCE_REJECTED") {
        setError("生成内容未通过合规检查，请调整参数重试。");
      } else if (reason === "KP_SUBJECT_MISMATCH") {
        setError("选择的知识点与学科不匹配，请刷新后重试。");
      } else {
        setError("出卷失败，请稍后再试。");
      }
    },
  });

  function toggleKp(id: string) {
    setSelectedKpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleType(t: QuestionTypeValue) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  const canSubmit =
    !generate.isPending &&
    selectedKpIds.length > 0 &&
    selectedTypes.length > 0 &&
    diffMin <= diffMax &&
    count >= 1 &&
    count <= 30;

  function submit() {
    setError(null);
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      questionTypes: selectedTypes,
      difficultyRange: [diffMin, diffMax],
      count,
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
        <p className="text-sm font-medium text-slate-700">
          知识点（至少选 1 个）
        </p>
        <div
          className="mt-2 flex flex-wrap gap-2"
          data-testid="kp-picker"
        >
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

      {/* 题型 */}
      <div>
        <p className="text-sm font-medium text-slate-700">
          题型（至少选 1 个）
        </p>
        <div className="mt-2 flex flex-wrap gap-2" data-testid="type-picker">
          {QUESTION_TYPES.map((t) => {
            const selected = selectedTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
                data-testid={`type-${t}`}
              >
                {questionTypeLabel(t)}
              </button>
            );
          })}
        </div>
        {selectedTypes.length === 0 && (
          <p className="mt-1 text-xs text-red-600">请至少选一种题型。</p>
        )}
      </div>

      {/* 难度范围 */}
      <div>
        <p className="text-sm font-medium text-slate-700">难度范围（1 最简单，5 最难）</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            最低
            <select
              value={diffMin}
              onChange={(e) => setDiffMin(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2 py-1"
              data-testid="diff-min"
            >
              {[1, 2, 3, 4, 5].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <span className="text-slate-400">&ndash;</span>
          <label className="flex items-center gap-2">
            最高
            <select
              value={diffMax}
              onChange={(e) => setDiffMax(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2 py-1"
              data-testid="diff-max"
            >
              {[1, 2, 3, 4, 5].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {diffMin > diffMax && (
            <p className="text-xs text-red-600">最低难度不能大于最高难度。</p>
          )}
        </div>
      </div>

      {/* 题量 */}
      <div>
        <label className="block text-sm font-medium text-slate-700">
          题量（1–30 题）
        </label>
        <input
          type="number"
          min={1}
          max={30}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="mt-1 w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          data-testid="count-input"
        />
        {(count < 1 || count > 30) && (
          <p className="mt-1 text-xs text-red-600">题量须在 1 到 30 之间。</p>
        )}
      </div>

      {/* Credits 提示 */}
      <p className="text-sm text-slate-500">
        出卷消耗 5 credits（题库命中越多，AI 调用越少）。
      </p>

      {/* 生成中面板 */}
      {generate.isPending && (
        <AiGeneratingPanel label="AI 出卷中，请稍候…" />
      )}

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
        {generate.isPending ? "生成中…" : "生成试卷"}
      </button>
    </section>
  );
}
