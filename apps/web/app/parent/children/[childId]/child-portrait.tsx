"use client";
import { StatePanel } from "@/components/ui/state-panel";
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
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="dsar-child-approval">
      <h2 className="text-lg font-semibold">子女注销申请</h2>
      <p className="text-sm text-slate-700">您的孩子提交了账号注销申请,需要监护人确认后方可处理。注销不可恢复。</p>
      <button data-testid="dsar-approve-child" disabled={approve.isPending}
        onClick={() => approve.mutate({ childUserId: childId })}
        className="rounded-full bg-red-600 px-4 py-2 text-white disabled:opacity-50">确认子女注销申请</button>
    </section>
  ) : null;

  if (q.isLoading) return <div className="space-y-4">{approvalBlock}<StatePanel title="加载中..." /></div>;
  if (q.error) return <div className="space-y-4">{approvalBlock}<div data-testid="child-error"><StatePanel title="读取学情失败" description="请稍后再试。" /></div></div>;
  // 家长视角后端返回 { relationship:'parent', view }
  const view = q.data && "view" in q.data ? q.data.view : null;
  if (!view || !view.hasData) {
    return <div className="space-y-4">{approvalBlock}<div data-testid="child-empty"><StatePanel title="还没有足够的学情数据" description="完成一些练习或作业后，这里会显示近期巩固方向。" /></div></div>;
  }
  return (
    <div className="space-y-4" data-testid="child-portrait">
      {approvalBlock}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
          <div className="text-2xl font-semibold">{view.solidCount}</div>
          <div className="text-xs">掌握较稳</div>
        </div>
        <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
          <div className="text-2xl font-semibold">{view.progressingCount}</div>
          <div className="text-xs">正在巩固</div>
        </div>
        <div className="rounded-lg bg-sky-50 p-3 text-sky-800">
          <div className="text-2xl font-semibold">{view.focusCount}</div>
          <div className="text-xs">重点关注</div>
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
