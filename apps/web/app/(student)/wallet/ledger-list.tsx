"use client";

import { trpc } from "@/lib/trpc-client";

const KIND_LABEL: Record<string, string> = {
  TOPUP: "充值",
  DEBIT: "扣费",
  COMPENSATION: "补偿",
  ADJUST_ADD: "OPS 调账（增）",
  ADJUST_SUB: "OPS 调账（减）",
};

export function LedgerList() {
  const q = trpc.wallet.ledgerList.useQuery({ limit: 20 });
  if (q.isLoading) return <section>加载中…</section>;
  if (q.isError) {
    return (
      <section className="text-red-600">读取流水失败：{q.error.message}</section>
    );
  }
  const entries = q.data!.entries;
  return (
    <section data-testid="ledger-list">
      <h2 className="text-lg font-semibold mb-2">流水</h2>
      <ul className="divide-y rounded border">
        {entries.map((e) => (
          <li key={e.id} className="flex justify-between p-3 text-sm">
            <div>
              <div>
                {KIND_LABEL[e.kind] ?? e.kind}
                {e.actionKind ? `（${e.actionKind}）` : ""}
              </div>
              <div className="text-slate-500 text-xs">
                {new Date(e.createdAt).toLocaleString()}
              </div>
            </div>
            <div
              className={`font-mono ${e.delta < 0 ? "text-red-600" : "text-emerald-600"}`}
            >
              {e.delta > 0 ? "+" : ""}
              {e.delta}
            </div>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="p-3 text-sm text-slate-500">暂无流水</li>
        )}
      </ul>
    </section>
  );
}
