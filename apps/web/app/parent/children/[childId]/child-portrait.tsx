"use client";
import { trpc } from "@/lib/trpc-client";

export function ChildPortrait({ childId }: { childId: string }) {
  const q = trpc.analytics.profile.get.useQuery({ studentUserId: childId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (q.error) return <p className="text-sm text-red-600" data-testid="child-error">{q.error.message}</p>;
  // 家长视角后端返回 { relationship:'parent', view }
  const view = q.data && "view" in q.data ? q.data.view : null;
  if (!view || !view.hasData) {
    return <p className="text-sm text-slate-600" data-testid="child-empty">孩子还没有足够的学情数据。</p>;
  }
  return (
    <div className="space-y-4" data-testid="child-portrait">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border bg-emerald-50 p-3">
          <div className="text-2xl font-semibold">{view.solidCount}</div>
          <div className="text-xs">掌握扎实</div>
        </div>
        <div className="rounded border bg-amber-50 p-3">
          <div className="text-2xl font-semibold">{view.progressingCount}</div>
          <div className="text-xs">稳步提升</div>
        </div>
        <div className="rounded border bg-sky-50 p-3">
          <div className="text-2xl font-semibold">{view.focusCount}</div>
          <div className="text-xs">建议关注</div>
        </div>
      </div>
      {view.focusAreas.length > 0 && (
        <p className="text-sm text-slate-700">建议一起关注：{view.focusAreas.join("、")}</p>
      )}
      {view.strengths.length > 0 && (
        <p className="text-sm text-slate-600">掌握扎实：{view.strengths.join("、")}</p>
      )}
    </div>
  );
}
