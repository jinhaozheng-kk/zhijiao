"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
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
import { ZHONGKAO_TEMPLATE_ID } from "@/lib/zhongkao-blueprint";

type KpOption = { id: string; name: string };
type SectionConfig = { count: number; pointsPerItem: number };

export function computePaperTotals(
  sections: Partial<Record<QuestionTypeValue, { count: number; pointsPerItem: number }>>,
): { totalCount: number; totalPoints: number } {
  let totalCount = 0;
  let totalPoints = 0;
  for (const cfg of Object.values(sections)) {
    if (!cfg) continue;
    totalCount += cfg.count || 0;
    totalPoints += (cfg.count || 0) * (cfg.pointsPerItem || 0);
  }
  return { totalCount, totalPoints };
}

const DEFAULT_POINTS: Record<QuestionTypeValue, number> = {
  SINGLE_CHOICE: 3,
  MULTI_CHOICE: 4,
  FILL_BLANK: 3,
  CALCULATION: 8,
  PROOF: 10,
  ESSAY: 12,
};

// 自动审题 blocker code → 教师能看懂的一句话。服务端 errorFormatter 会把
// cause.blockers 透出到 error.data.blockers（见 apps/web/server/trpc.ts）。
const BLOCKER_HINTS: Record<string, string> = {
  CHOICE_OPTION_COUNT: "选择题选项格式异常（模型把选项拼成了一行）",
  CHOICE_OPTIONS_MISSING: "选择题缺少选项",
  EMPTY_ANSWER: "部分题目缺少答案",
  MISSING_SOLUTION: "部分题目缺少解析",
  TYPE_MISMATCH: "题型与题位不一致",
  FILL_HAS_OPTIONS: "填空题混入了选项",
  FORBIDDEN_PHRASE: "内容命中合规禁用措辞",
};

function blockerHint(codes: unknown): string {
  if (!Array.isArray(codes)) return "";
  const hints = [...new Set(codes.map((code) => BLOCKER_HINTS[String(code)]).filter(Boolean))];
  return hints.length > 0 ? `问题：${hints.join("；")}。` : "";
}

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
  const [watchdogVisible, setWatchdogVisible] = useState(false);
  // Track which submit function was last called so the "重试" button replays it
  const lastSubmitRef = useRef<"normal" | "zhongkao">("normal");

  const generate = trpc.paper.generate.useMutation({
    onSuccess: (result) => router.push(`/teacher/papers/${result.paperId}`),
    onError: (e) => {
      const data = e.data as
        | { reason?: string; blockers?: unknown; shortfallByType?: Record<string, number> }
        | undefined;
      const reason = data?.reason;
      if (reason === "INSUFFICIENT_BALANCE") {
        setError("Credits 余额不足，请先充值后再出卷。");
      } else if (reason === "COMPLIANCE_REJECTED") {
        setError("生成内容未通过合规检查（已退还 credits），请调整知识点后重试。");
      } else if (reason === "KP_SUBJECT_MISMATCH") {
        setError("所选知识点与学科不匹配，请刷新后重试。");
      } else if (reason === "PAPER_DEDUP_SHORTFALL") {
        const shortfall = data?.shortfallByType;
        let msg = "题目重复率过高，未能凑满题量（已退还 credits）。建议减少题量或更换/增加知识点后重试。";
        if (shortfall && Object.keys(shortfall).length > 0) {
          const parts = Object.entries(shortfall)
            .filter(([, count]) => count > 0)
            .map(([type, count]) => `${questionTypeLabel(type as QuestionTypeValue)} 缺 ${count} 题`);
          if (parts.length > 0) {
            msg += `缺口：${parts.join("、")}。`;
          }
        }
        setError(msg);
      } else if (reason === "PAPER_REVIEW_BLOCKED") {
        const detail = blockerHint(data?.blockers);
        setError(
          `未生成合格可用试卷，自动审题未通过（已退还 credits）。${detail}请点「重试」；若反复出现，请更换/增加知识点或减少题量。`,
        );
      } else {
        setError("出卷失败（若已扣除将自动退还 credits），请稍后再试。");
      }
    },
  });

  // C3: 180s watchdog — while pending, count up; show banner at 180s
  useEffect(() => {
    if (!generate.isPending) {
      setWatchdogVisible(false);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      if (Date.now() - start >= 180_000) {
        setWatchdogVisible(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [generate.isPending]);

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
  const { totalCount, totalPoints } = computePaperTotals(sections);

  const canSubmit =
    !generate.isPending &&
    selectedKpIds.length > 0 &&
    activeTypes.length > 0 &&
    diffMin <= diffMax &&
    totalCount >= 1 &&
    totalCount <= 30 &&
    durationMinutes >= 1 &&
    durationMinutes <= 300 &&
    activeTypes.every((t) => sections[t]!.count >= 1 && sections[t]!.pointsPerItem >= 1);

  function submit() {
    setError(null);
    lastSubmitRef.current = "normal";
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

  function submitZhongkao() {
    setError(null);
    lastSubmitRef.current = "zhongkao";
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      styleTemplate: ZHONGKAO_TEMPLATE_ID,
      durationMinutes,
      textbookVersion,
      clientRequestId: crypto.randomUUID(),
    });
  }

  function retry() {
    if (lastSubmitRef.current === "zhongkao") submitZhongkao();
    else submit();
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

      {generate.isPending && <AiGeneratingPanel />}

      {generate.isPending && watchdogVisible && (
        <div
          className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="generate-watchdog"
        >
          出卷时间超过预期。可继续等待，或放弃等待（后台任务仍会继续，成功后可在「我的试卷」列表查看；本次 credits 不再退还）。
          {" "}
          <button
            type="button"
            onClick={() => { generate.reset(); setWatchdogVisible(false); }}
            className="underline"
            data-testid="abandon-wait"
          >
            放弃等待
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700" data-testid="generate-error">
          {error}{" "}
          <button type="button" onClick={retry} className="underline" data-testid="generate-retry">重试</button>
        </p>
      )}

      <div className="space-y-2">
        <button
          type="button"
          disabled={generate.isPending || selectedKpIds.length === 0}
          onClick={submitZhongkao}
          className="rounded-full border border-slate-950 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="generate-zhongkao"
        >
          一键生成中考风格卷（120 分 · 24 题）
        </button>
        <p className="text-xs text-slate-500">
          中考风格卷按固定命题结构生成：选择 10 题、填空 6 题、解答 8 题，分值与结构由模板决定。
        </p>
      </div>

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
