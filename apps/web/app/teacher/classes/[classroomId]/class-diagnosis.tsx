"use client";
import { trpc } from "@/lib/trpc-client";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";

export function ClassDiagnosis({ classroomId }: { classroomId: string }) {
  const q = trpc.analytics.classroom.diagnosis.useQuery({ classroomId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载诊断中…</p>;
  if (q.error) return <p className="text-sm text-red-600">{q.error.message}</p>;
  const d = q.data?.diagnosis;
  if (!d || d.kpStats.length === 0)
    return (
      <p className="text-sm text-slate-600" data-testid="class-diagnosis-empty">
        暂无足够数据生成班级诊断。
      </p>
    );
  return (
    <div className="space-y-3" data-testid="class-diagnosis">
      {d.topFocusKps.length > 0 && (
        <p className="text-sm text-slate-700">建议优先讲评：{d.topFocusKps.join("、")}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {d.kpStats.map((s) => (
          <div key={s.kpId} className={`rounded border px-3 py-2 ${TIER_COLOR[s.classTier]}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.kpName}</span>
              <span className="text-xs">{tierLabel(s.classTier)}</span>
            </div>
            <p className="mt-1 text-xs opacity-80">
              需重点巩固学生 {s.focusStudentCount}/{s.sampleStudents}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
