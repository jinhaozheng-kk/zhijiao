"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

// Yuan presets in cents. Capped at 1000元 (= 100_000 cents) per the
// wallet.topupCreate input refine.
const PRESETS_CENTS = [100, 500, 1000, 5000];

export function TopupForm() {
  const utils = trpc.useUtils();
  const balance = trpc.wallet.balance.useQuery();
  const topup = trpc.wallet.topupCreate.useMutation({
    onSuccess: async () => {
      // The mock adapter fires the webhook ~50ms after order creation
      // (notifyMode='async-delayed'); polling once after a short delay
      // catches the credit landing without a websocket. Real V3 would
      // route through the same query — webhook → balance invalidate.
      await new Promise((r) => setTimeout(r, 300));
      await utils.wallet.balance.invalidate();
      await utils.wallet.ledgerList.invalidate();
    },
  });
  const [amountCents, setAmountCents] = useState(100);
  const [lastOrder, setLastOrder] = useState<{
    orderId: string;
    prepayId: string;
    qrCode?: string;
    h5Url?: string;
    credits: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (balance.isLoading) return <section>加载中…</section>;
  if (balance.isError) {
    return (
      <section className="text-red-600">读取余额失败：{balance.error.message}</section>
    );
  }
  const bal = balance.data!;

  return (
    <section className="space-y-4">
      <div className="rounded border p-4">
        <div className="text-sm text-slate-500">当前余额</div>
        <div className="text-3xl font-semibold">{bal.balance} 点</div>
        {bal.monthly && (
          <div className="mt-2 text-xs text-amber-700">
            未成年月度额度：已用 {bal.monthly.topupYuan} / 上限{" "}
            {bal.monthly.limitYuan} 元（剩余 {bal.monthly.remainingYuan} 元）
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {PRESETS_CENTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setAmountCents(c)}
            className={`rounded border px-3 py-1 text-sm ${
              amountCents === c ? "bg-slate-900 text-white" : ""
            }`}
            data-testid={`topup-preset-${c}`}
          >
            {c / 100} 元
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={topup.isPending}
        onClick={async () => {
          setErr(null);
          try {
            const r = await topup.mutateAsync({ amountCents });
            setLastOrder(r);
          } catch (e) {
            const reason =
              (e as { data?: { reason?: string } } | null)?.data?.reason ??
              (e as Error).message;
            setErr(reason);
          }
        }}
        className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        data-testid="topup-submit"
      >
        {topup.isPending ? "下单中…" : `充值 ${amountCents / 100} 元`}
      </button>

      {err && (
        <p data-testid="topup-error" className="text-red-600 text-sm">
          {err}
        </p>
      )}

      {lastOrder && (
        <div
          data-testid="topup-order-card"
          className="rounded border p-3 text-sm space-y-1"
        >
          <div>订单号：{lastOrder.orderId}</div>
          <div>预支付 ID：{lastOrder.prepayId}</div>
          <div>到账 Credit：{lastOrder.credits}</div>
          {lastOrder.qrCode && (
            <div className="font-mono text-xs">
              扫码（mock）：{lastOrder.qrCode}
            </div>
          )}
          <div className="text-slate-500 text-xs">
            支付完成后余额会自动更新（几秒内）。
          </div>
        </div>
      )}
    </section>
  );
}
