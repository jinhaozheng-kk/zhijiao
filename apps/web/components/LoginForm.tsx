"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const send = trpc.auth.otpRequest.useMutation({
    onSuccess: () => router.push(`/otp-verify?phone=${encodeURIComponent(phone)}`),
  });
  return (
    <div className="space-y-3">
      <input
        type="tel" inputMode="numeric" maxLength={11}
        value={phone} onChange={(e) => setPhone(e.target.value)}
        className="border rounded w-full px-3 py-2"
        placeholder="手机号"
        data-testid="login-phone"
      />
      <button
        disabled={send.isPending || !/^1\d{10}$/.test(phone)}
        onClick={() => send.mutate({ phone })}
        className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
        data-testid="login-send"
      >
        {send.isPending ? "发送中..." : "发送验证码"}
      </button>
      {send.error && <p className="text-red-600 text-sm" data-testid="login-error">{send.error.message}</p>}
      <div className="text-center text-sm text-slate-500">
        <a href="/wechat/start" data-testid="login-wechat">使用微信登录</a>
      </div>
    </div>
  );
}
