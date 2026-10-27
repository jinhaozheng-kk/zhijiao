import type { AnswerVerifyResult } from "@zhijiao/ai";

export interface AnswerCheckSummary {
  checkedAt?: string;
  total: number;
  wrong: number;
  uncertain: number;
  results: AnswerVerifyResult[];
}

/**
 * 预览页「AI 答案抽检」结果面板：只做展示，判定逻辑在后端（第二模型异构判卷）。
 * 存疑/无法判定的题给出题号与理由，方便教师直接定位核对。
 */
export function AnswerCheckPanel({ check }: { check: AnswerCheckSummary | null | undefined }) {
  if (!check || check.total <= 0 || !Array.isArray(check.results)) return null;
  const wrong = check.results.filter((item) => item.verdict === "WRONG");
  const uncertain = check.results.filter((item) => item.verdict === "UNCERTAIN");
  const correct = check.total - wrong.length - uncertain.length;
  const hasIssue = wrong.length > 0 || uncertain.length > 0;

  return (
    <section
      className={`rounded-lg p-5 shadow-sm ring-1 ${
        wrong.length > 0 ? "bg-red-50 ring-red-200" : "bg-emerald-50 ring-emerald-200"
      }`}
      data-testid="answer-check-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">AI 答案抽检</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            wrong.length > 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {wrong.length > 0 ? `发现 ${wrong.length} 题存疑` : "未发现明显错误"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-700">
        共抽检 {check.total} 题：正确 {correct} 题 · 存疑 {wrong.length} 题 · 无法判定 {uncertain.length} 题
        {check.checkedAt ? `（${new Date(check.checkedAt).toLocaleString()}）` : ""}
      </p>
      {hasIssue ? (
        <ul className="mt-2 space-y-1 text-sm">
          {wrong.map((item) => (
            <li key={`wrong-${item.questionNo}`} className="text-red-800" data-testid="answer-check-wrong">
              <a
                href={`#paper-item-${item.questionNo}`}
                className="font-medium underline hover:text-red-900"
                data-testid="answer-check-link"
              >
                第 {item.questionNo} 题
              </a>
              （存疑）：{item.reason || "答案与解析可能不一致"}
            </li>
          ))}
          {uncertain.map((item) => (
            <li key={`uncertain-${item.questionNo}`} className="text-amber-800">
              <a
                href={`#paper-item-${item.questionNo}`}
                className="font-medium underline hover:text-amber-900"
                data-testid="answer-check-link"
              >
                第 {item.questionNo} 题
              </a>
              （无法判定）：{item.reason || "信息不足，建议人工确认"}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        抽检由另一个 AI 模型独立完成，仅作参考；最终以教师人工核对为准。
      </p>
    </section>
  );
}
