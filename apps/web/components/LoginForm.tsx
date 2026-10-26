"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const send = trpc.auth.otpRequest.useMutation({
    onSuccess: (result) => {
      const params = new URLSearchParams({ phone });
      if ("devCode" in result && result.devCode) params.set("devCode", result.devCode);
      router.push(`/otp-verify?${params.toString()}`);
    },
  });
  const login = trpc.auth.passwordLogin.useMutation({
    onSuccess: (result) => router.push(result.defaultRoute),
  });
  const error = mode === "otp" ? send.error : login.error;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded border border-slate-200 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("otp")}
          className={`rounded px-3 py-2 ${mode === "otp" ? "bg-slate-900 text-white" : "text-slate-600"}`}
        >
          验证码登录
        </button>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`rounded px-3 py-2 ${mode === "password" ? "bg-slate-900 text-white" : "text-slate-600"}`}
        >
          密码登录
        </button>
      </div>
      <input
        type="tel" inputMode="numeric"
        value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
        className="border rounded w-full px-3 py-2"
        placeholder="手机号"
        data-testid="login-phone"
      />
      {mode === "password" && (
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded w-full px-3 py-2"
          placeholder="密码"
          data-testid="login-password"
        />
      )}
      {mode === "otp" ? (
        <button
          disabled={send.isPending || !/^1\d{10}$/.test(phone)}
          onClick={() => send.mutate({ phone })}
          className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
          data-testid="login-send"
        >
          {send.isPending ? "发送中..." : "发送验证码"}
        </button>
      ) : (
        <button
          disabled={login.isPending || !/^1\d{10}$/.test(phone) || password.length < 8}
          onClick={() => login.mutate({ phone, password })}
          className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
          data-testid="login-password-submit"
        >
          {login.isPending ? "登录中..." : "登录"}
        </button>
      )}
      {error && <p className="text-red-600 text-sm" data-testid="login-error">{error.message}</p>}
      <div className="text-center text-sm text-slate-500">
        <a href="/wechat/start" data-testid="login-wechat">使用微信登录</a>
      </div>
    </div>
  );
}
