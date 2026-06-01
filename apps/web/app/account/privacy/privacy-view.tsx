"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function PrivacyView() {
  const utils = trpc.useUtils();
  const my = trpc.dsar.myRequests.useQuery();
  const open = my.data?.requests.find((r) => r.type === "DELETION" && (r.status === "PENDING" || r.status === "AWAITING_GUARDIAN"));
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const exportMine = trpc.dsar.exportMine.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `zhijiao-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      void utils.dsar.myRequests.invalidate();
    },
    onError: (e) => setErr(e.message),
  });
  const sendOtp = trpc.dsar.sendDeletionOtp.useMutation({
    onSuccess: () => { setOtpSent(true); setErr(null); },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setErr(reason === "DSAR_NO_PHONE" ? "未绑定手机号,请通过客服渠道办理注销。" : reason === "DSAR_GUARDIAN_REQUIRED" ? "未成年人注销需由监护人确认。" : e.message);
    },
  });
  const requestDeletion = trpc.dsar.requestDeletion.useMutation({
    onSuccess: () => { setOtpSent(false); setCode(""); setReason(""); void utils.dsar.myRequests.invalidate(); },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setErr(reason === "DSAR_GUARDIAN_REQUIRED" ? "未成年人注销需由已绑定的监护人在站内确认,请先绑定监护人。" : e.message);
    },
  });
  const cancel = trpc.dsar.cancelDeletion.useMutation({ onSuccess: () => void utils.dsar.myRequests.invalidate(), onError: (e) => setErr(e.message) });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">下载我的数据副本</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 45 条,您可获取个人信息副本(JSON)。</p>
        <button data-testid="dsar-export" disabled={exportMine.isPending} onClick={() => { setErr(null); exportMine.mutate(); }}
          className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">{exportMine.isPending ? "生成中..." : "下载数据副本"}</button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">申请注销账号</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 47 条。注销不可恢复,我们在 15 个工作日内处理,处理前可随时撤销。未成年人需由已绑定的监护人在站内确认。</p>
        {open ? (
          <div className="space-y-2" data-testid="dsar-pending">
            <p className="text-sm">{open.status === "AWAITING_GUARDIAN" ? "等待监护人确认" : "注销申请处理中"},预计完成:{new Date(open.dueAt).toLocaleDateString("zh-CN")}</p>
            <button data-testid="dsar-delete-cancel" disabled={cancel.isPending} onClick={() => { setErr(null); cancel.mutate(); }} className="rounded border px-4 py-2">撤销申请</button>
          </div>
        ) : !otpSent ? (
          <button data-testid="dsar-send-otp" disabled={sendOtp.isPending} onClick={() => { setErr(null); sendOtp.mutate(); }} className="rounded border px-4 py-2">发送验证码以申请注销</button>
        ) : (
          <div className="space-y-2">
            <input data-testid="dsar-otp-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" className="border rounded px-3 py-2 w-full" />
            <textarea data-testid="dsar-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="注销原因(可选)" className="border rounded px-3 py-2 w-full" />
            <button data-testid="dsar-delete-submit" disabled={requestDeletion.isPending || code.length < 4}
              onClick={() => { setErr(null); requestDeletion.mutate({ otpCode: code, reason: reason || undefined }); }}
              className="rounded bg-red-600 text-white px-4 py-2 disabled:opacity-50">提交注销申请</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">我的请求记录</h2>
        <ul className="text-sm space-y-1" data-testid="dsar-requests">
          {(my.data?.requests ?? []).map((r) => (
            <li key={r.id}>
              {r.type === "EXPORT" ? "数据副本" : "注销"} · {r.status} · {new Date(r.requestedAt).toLocaleDateString("zh-CN")}
              {r.rejectionReason && <span className="text-red-600">（驳回理由：{r.rejectionReason}）</span>}
            </li>
          ))}
        </ul>
      </section>

      {err && <p className="text-red-600 text-sm" data-testid="dsar-error">{err}</p>}
    </div>
  );
}
