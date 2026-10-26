"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

export function OtpForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const phone = sp.get("phone") ?? "";
  const devCode = sp.get("devCode")?.replace(/\D/g, "").slice(0, 6) ?? "";
  const [code, setCode] = useState(devCode);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const verify = trpc.auth.otpVerify.useMutation({
    onSuccess: (r) => {
      if (r.status === "logged_in") router.push(r.defaultRoute);
      else router.push("/register");
    },
  });
  const resend = trpc.auth.otpRequest.useMutation({ onSuccess: () => setCooldown(60) });

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">验证码已发到 {phone}</p>
      {devCode && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="otp-dev-code">
          本地开发验证码：<span className="font-mono tracking-widest">{devCode}</span>
        </p>
      )}
      <input
        type="text" inputMode="numeric"
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="border rounded w-full px-3 py-2 tracking-widest text-center"
        placeholder="6 位验证码"
        data-testid="otp-code"
      />
      <button
        disabled={verify.isPending || !/^\d{6}$/.test(code)}
        onClick={() => verify.mutate({ phone, code })}
        className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
        data-testid="otp-submit"
      >
        {verify.isPending ? "校验中..." : "登录"}
      </button>
      {verify.error && <p className="text-red-600 text-sm" data-testid="otp-error">{verify.error.message}</p>}
      <button
        disabled={cooldown > 0 || resend.isPending}
        onClick={() => resend.mutate({ phone })}
        className="w-full text-sm text-slate-500 disabled:opacity-40"
      >
        {cooldown > 0 ? `${cooldown}s 后可重发` : "重发验证码"}
      </button>
    </div>
  );
}
