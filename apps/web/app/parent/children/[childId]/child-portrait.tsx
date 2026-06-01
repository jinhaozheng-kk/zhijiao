"use client";
import { trpc } from "@/lib/trpc-client";

export function ChildPortrait({ childId }: { childId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.analytics.profile.get.useQuery({ studentUserId: childId, window: "D90" });
  const approvals = trpc.dsar.pendingChildApprovals.useQuery();
  const approve = trpc.dsar.approveChildDeletion.useMutation({
    onSuccess: () => { void utils.dsar.pendingChildApprovals.invalidate(); },
  });
  const pendingForChild = (approvals.data?.items ?? []).filter((i) => i.childUserId === childId);

  const approvalBlock = pendingForChild.length > 0 ? (
    <section className="rounded border border-amber-300 bg-amber-50 p-4 space-y-2" data-testid="dsar-child-approval">
      <h2 className="text-lg font-semibold">子女注销申请</h2>
      <p className="text-sm text-slate-700">您的孩子提交了账号注销申请,需要监护人确认后方可处理。注销不可恢复。</p>
      <button data-testid="dsar-approve-child" disabled={approve.isPending}
        onClick={() => approve.mutate({ childUserId: childId })}
        className="rounded bg-red-600 text-white px-4 py-2 disabled:opacity-50">确认子女注销申请</button>
    </section>
  ) : null;

  if (q.isLoading) return <div className="space-y-4">{approvalBlock}<p className="text-sm text-slate-500">加载中…</p></div>;
  if (q.error) return <div className="space-y-4">{approvalBlock}<p className="text-sm text-red-600" data-testid="child-error">{q.error.message}</p></div>;
  // 家长视角后端返回 { relationship:'parent', view }
  const view = q.data && "view" in q.data ? q.data.view : null;
  if (!view || !view.hasData) {
    return <div className="space-y-4">{approvalBlock}<p className="text-sm text-slate-600" data-testid="child-empty">孩子还没有足够的学情数据。</p></div>;
  }
  return (
    <div className="space-y-4" data-testid="child-portrait">
      {approvalBlock}
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
