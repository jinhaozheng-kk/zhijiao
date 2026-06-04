import Link from "next/link";
import {
  cognitiveLevelLabel,
  paperItemSourceLabel,
  questionTypeLabel,
  type CognitiveLevelValue,
  type QuestionTypeValue,
} from "@/lib/paper-copy";
import { StatusPill } from "@/components/ui/status-pill";

export type PaperSpecRow = {
  kp: string;
  cognitiveLevel: string;
  type: string;
  difficulty: number;
  count: number;
  points: number;
};

export type PaperSpecTableData = {
  rows: PaperSpecRow[];
  totalCount: number;
  totalPoints: number;
};

export function PaperSpecTable({ specTable }: { specTable: PaperSpecTableData }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">双向细目表</h2>
          <p className="mt-1 text-sm text-slate-500">
            合计 {specTable.totalCount} 题 · {specTable.totalPoints} 分
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="border-b">
              <th className="whitespace-nowrap py-2 pr-4 font-medium">知识点</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">能力层级</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">题型</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">难度</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">题数</th>
              <th className="whitespace-nowrap py-2 font-medium">分值</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {specTable.rows.map((row) => (
              <tr
                key={`${row.kp}-${row.cognitiveLevel}-${row.type}-${row.difficulty}`}
              >
                <td className="whitespace-nowrap py-3 pr-4">{row.kp}</td>
                <td className="whitespace-nowrap py-3 pr-4">
                  {cognitiveLevelLabel(row.cognitiveLevel as CognitiveLevelValue)}
                </td>
                <td className="whitespace-nowrap py-3 pr-4">
                  {questionTypeLabel(row.type as QuestionTypeValue)}
                </td>
                <td className="whitespace-nowrap py-3 pr-4">{row.difficulty}</td>
                <td className="whitespace-nowrap py-3 pr-4">{row.count}</td>
                <td className="whitespace-nowrap py-3">{row.points} 分</td>
              </tr>
            ))}
            {specTable.rows.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-slate-500" colSpan={6}>
                  暂无题目
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PaperItemSourcePill({ source }: { source: string }) {
  return (
    <StatusPill tone={source === "BANK" ? "blue" : "amber"}>
      {paperItemSourceLabel(source)}
    </StatusPill>
  );
}

export function PrintLink({ paperId }: { paperId: string }) {
  return (
    <Link
      href={`/teacher/papers/${paperId}/print`}
      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      打印/导出
    </Link>
  );
}
