"use client";
import { trpc } from "@/lib/trpc-client";

export function FamilyLinkView() {
  const create = trpc.family.createInviteCode.useMutation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        生成邀请码给家长，家长输入后即可<strong>只读</strong>查看你的学情。邀请码 15 分钟内有效、仅可使用一次。
      </p>
      <button
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        data-testid="btn-create-invite"
      >
        {create.isPending ? "生成中…" : "生成邀请码"}
      </button>
      {create.data && (
        <div className="rounded border bg-slate-50 p-4" data-testid="invite-code">
          <p className="text-sm text-slate-600">把这串邀请码发给家长：</p>
          <p className="mt-1 font-mono text-2xl tracking-widest">{create.data.code}</p>
          <p className="mt-1 text-xs text-slate-500">{Math.round(create.data.expiresInSec / 60)} 分钟内有效</p>
        </div>
      )}
    </div>
  );
}
