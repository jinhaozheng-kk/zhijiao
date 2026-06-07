"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";
import {
  QUESTION_TYPES,
  GRADE_LEVELS,
  TEXTBOOK_VERSIONS,
  questionTypeLabel,
  gradeLevelLabel,
  textbookVersionLabel,
  type GradeLevel,
  type QuestionTypeValue,
  type TextbookVersion,
} from "@/lib/paper-copy";

type KpOption = { id: string; name: string };
type SectionConfig = { count: number; pointsPerItem: number };

const DEFAULT_POINTS: Record<QuestionTypeValue, number> = {
  SINGLE_CHOICE: 3,
  MULTI_CHOICE: 4,
  FILL_BLANK: 3,
  CALCULATION: 8,
  PROOF: 10,
  ESSAY: 12,
};

export function PaperGenerationForm({
  subjectId,
  kps,
}: {
  subjectId: string;
  kps: KpOption[];
}) {
  const router = useRouter();
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>("G8");
  const [textbookVersion, setTextbookVersion] = useState<TextbookVersion>("GENERIC");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [selectedKpIds, setSelectedKpIds] = useState<string[]>(
    kps.slice(0, 1).map((k) => k.id),
  );
  const [sections, setSections] = useState<Partial<Record<QuestionTypeValue, SectionConfig>>>({
    SINGLE_CHOICE: { count: 6, pointsPerItem: 3 },
    CALCULATION: { count: 4, pointsPerItem: 8 },
  });
  const [diffMin, setDiffMin] = useState(2);
  const [diffMax, setDiffMax] = useState(4);
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.paper.generate.useMutation({
    onSuccess: (result) => router.push(`/teacher/papers/${result.paperId}`),
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      if (reason === "INSUFFICIENT_BALANCE") setError("Credits 余额不足，请先充值后再出卷。");
      else if (reason === "COMPLIANCE_REJECTED") setError("生成内容未通过合规检查，请调整参数重试。");
      else if (reason === "KP_SUBJECT_MISMATCH") setError("选择的知识点与学科不匹配，请刷新后重试。");
      else setError("出卷失败，请稍后再试。");
    },
  });

  function toggleKp(id: string) {
    setSelectedKpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleType(t: QuestionTypeValue) {
    setSections((prev) => {
      const next = { ...prev };
      if (next[t]) delete next[t];
      else next[t] = { count: 5, pointsPerItem: DEFAULT_POINTS[t] };
      return next;
    });
  }

  function patchSection(t: QuestionTypeValue, patch: Partial<SectionConfig>) {
    setSections((prev) => ({ ...prev, [t]: { ...prev[t]!, ...patch } }));
  }

  const activeTypes = QUESTION_TYPES.filter((t) => sections[t]);
  const totalCount = activeTypes.reduce((n, t) => n + (sections[t]!.count || 0), 0);
  const totalPoints = activeTypes.reduce(
    (n, t) => n + (sections[t]!.count || 0) * (sections[t]!.pointsPerItem || 0),
    0,
  );

  const canSubmit =
    !generate.isPending &&
    selectedKpIds.length > 0 &&
    activeTypes.length > 0 &&
    diffMin <= diffMax &&
    totalCount >= 1 &&
    totalCount <= 30 &&
    activeTypes.every((t) => sections[t]!.count >= 1 && sections[t]!.pointsPerItem >= 1);

  function submit() {
    setError(null);
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      sections: activeTypes.map((t) => ({
        type: t,
        count: sections[t]!.count,
        pointsPerItem: sections[t]!.pointsPerItem,
      })),
      difficultyRange: [diffMin, diffMax],
      durationMinutes,
      textbookVersion,
      clientRequestId: crypto.randomUUID(),
    });
  }

  return (
    <section className="mt-6 space-y-6 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">年级</label>
          <select
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value as GradeLevel)}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="grade-select"
          >
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>{gradeLevelLabel(g)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">教材版本</label>
          <select
            value={textbookVersion}
            onChange={(e) => setTextbookVersion(e.target.value as TextbookVersion)}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="textbook-select"
          >
            {TEXTBOOK_VERSIONS.map((v) => (
              <option key={v} value={v}>{textbookVersionLabel(v)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">考试时长（分钟）</label>
          <input
            type="number"
            min={1}
            max={300}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="mt-1 w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="duration-input"
          />
        </div>
      </div>

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
                  selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"
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

      <div>
        <p className="text-sm font-medium text-slate-700">题型与题数（至少选 1 种）</p>
        <div className="mt-2 space-y-2">
          {QUESTION_TYPES.map((t) => {
            const cfg = sections[t];
            return (
              <div key={t} className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`w-24 rounded-full border px-3 py-1 transition ${
                    cfg ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  data-testid={`type-toggle-${t}`}
                >
                  {questionTypeLabel(t)}
                </button>
                {cfg && (
                  <>
                    <label className="flex items-center gap-1">
                      题数
                      <input
                        type="number" min={1} max={30} value={cfg.count}
                        onChange={(e) => patchSection(t, { count: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1"
                        data-testid={`count-${t}`}
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      每题
                      <input
                        type="number" min={1} max={100} value={cfg.pointsPerItem}
                        onChange={(e) => patchSection(t, { pointsPerItem: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1"
                        data-testid={`points-${t}`}
                      />
                      分
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {activeTypes.length === 0 && (
          <p className="mt-1 text-xs text-red-600">请至少选一种题型。</p>
        )}
        {totalCount > 30 && (
          <p className="mt-1 text-xs text-red-600">总题量不超过 30 题（当前 {totalCount}）。</p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">难度范围（1 最简单，5 最难）</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            最低
            <select value={diffMin} onChange={(e) => setDiffMin(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1" data-testid="diff-min">
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <span className="text-slate-400">&ndash;</span>
          <label className="flex items-center gap-2">
            最高
            <select value={diffMax} onChange={(e) => setDiffMax(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1" data-testid="diff-max">
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {diffMin > diffMax && <p className="text-xs text-red-600">最低难度不能大于最高难度。</p>}
        </div>
      </div>

      <p className="text-sm text-slate-600">
        共 <span data-testid="total-count">{totalCount}</span> 题 · 满分{" "}
        <span data-testid="total-points" className="font-semibold">{totalPoints}</span> 分 ·
        出卷消耗 5 credits（题库命中越多，AI 调用越少）。
      </p>

      {generate.isPending && <AiGeneratingPanel label="AI 出卷中，请稍候…" />}

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700" data-testid="generate-error">
          {error}{" "}
          <button type="button" onClick={submit} className="underline" data-testid="generate-retry">重试</button>
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
