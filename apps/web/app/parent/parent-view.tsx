"use client";
import Link from "next/link";
import { useState } from "react";
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

  return (
    <div className="space-y-6">
      <section className="rounded border p-4">
        <h2 className="font-medium">绑定孩子</h2>
        <p className="mt-1 text-sm text-slate-600">输入孩子在「绑定家长」页生成的邀请码。</p>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="邀请码"
            className="rounded border px-3 py-2 text-sm font-mono"
            data-testid="input-invite-code"
          />
          <button
            onClick={() => bind.mutate({ code, guardianConsent: consent })}
            disabled={bind.isPending || code.length < 4}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
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
        {bind.error && <p className="mt-2 text-sm text-red-600" data-testid="bind-error">{bind.error.message}</p>}
      </section>

      <section>
        <h2 className="mb-2 font-medium">我的孩子</h2>
        <div className="divide-y rounded border" data-testid="children-list">
          {children.data?.children.map((c) => (
            <div key={c.linkId} className="flex items-center justify-between px-4 py-3">
              <span>
                {c.name ?? "（未设置昵称）"} · {c.gradeLevel ?? "—"}
              </span>
              <Link href={`/parent/children/${c.userId}`} className="text-sm text-emerald-700 underline">查看学情</Link>
            </div>
          ))}
          {children.data && children.data.children.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-600">还没有绑定孩子。</p>
          )}
        </div>
      </section>
    </div>
  );
}
