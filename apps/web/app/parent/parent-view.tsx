"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionCard } from "@/components/ui/action-card";
import { StatePanel } from "@/components/ui/state-panel";
import { copyForReason } from "@/lib/error-copy";
import { trpc } from "@/lib/trpc-client";

export function ParentView() {
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const utils = trpc.useUtils();
  const children = trpc.family.listMyChildren.useQuery();
  const bind = trpc.family.bindByCode.useMutation({
    onSuccess: () => {
      setCode("");
      setConsent(false);
      utils.family.listMyChildren.invalidate();
    },
  });
  const bindReason = (bind.error?.data as { reason?: string } | undefined)?.reason;

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-medium">绑定孩子</h2>
        <p className="mt-1 text-sm text-slate-600">输入孩子在「绑定家长」页生成的邀请码。</p>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="邀请码"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            data-testid="input-invite-code"
          />
          <button
            onClick={() => bind.mutate({ code, guardianConsent: consent })}
            disabled={bind.isPending || code.length < 4}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="btn-bind"
          >
            绑定
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
            data-testid="guardian-consent-checkbox"
          />
          <span>
            我确认是该未成年人的监护人，已知悉其学习数据将用于提供 AI 答疑、错题本与学情服务，并同意其使用本平台。若孩子未满 14 周岁，须勾选本项方可激活账号；同意可随时撤回。
          </span>
        </label>
        {bind.error && <p className="mt-2 text-sm text-red-600" data-testid="bind-error">{copyForReason(bindReason)}</p>}
      </section>

      <section>
        <h2 className="mb-3 font-medium">我的孩子</h2>
        <div className="grid gap-4" data-testid="children-list">
          {children.data?.children.map((c) => (
            <div key={c.linkId} className="space-y-3">
              <ActionCard
                href={`/parent/children/${c.userId}`}
                title={c.name ?? "孩子学情"}
                description={`${c.gradeLevel ?? "—"} · 查看近期巩固方向`}
                label="查看学情"
              />
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">掌握较稳</div>
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">正在巩固</div>
                <div className="rounded-lg bg-sky-50 px-3 py-2 text-sky-800">重点关注</div>
              </div>
            </div>
          ))}
          {children.data && children.data.children.length === 0 && (
            <StatePanel
              title="还没有绑定孩子"
              description="演示环境会自动准备绑定关系。请运行 pnpm demo:reset 后再试一次。"
            />
          )}
        </div>
      </section>
    </div>
  );
}
