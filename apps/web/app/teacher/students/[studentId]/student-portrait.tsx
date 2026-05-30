"use client";
import { trpc } from "@/lib/trpc-client";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";

export function StudentPortrait({ studentId }: { studentId: string }) {
  const q = trpc.analytics.profile.get.useQuery({ studentUserId: studentId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (q.error) return <p className="text-sm text-red-600" data-testid="student-error">{q.error.message}</p>;
  const profile = q.data && "profile" in q.data ? q.data.profile : null;
  if (!profile || !profile.hasData)
    return <p className="text-sm text-slate-600" data-testid="student-empty">该学生暂无足够学情数据。</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="student-portrait">
      {profile.masteries.map((m) => (
        <div key={m.kpId} className={`rounded border px-3 py-2 ${TIER_COLOR[m.tier]}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{m.kpName}</span>
            <span className="text-xs">{tierLabel(m.tier)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
