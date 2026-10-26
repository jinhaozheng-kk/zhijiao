"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function SecurityView() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const setAccountPassword = trpc.auth.setPassword.useMutation({
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      setMessage("密码已更新");
    },
    onError: (e) => setMessage(e.message),
  });
  const canSubmit = password.length >= 8 && password === confirm && !setAccountPassword.isPending;

  return (
    <section className="max-w-md space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">登录密码</h2>
        <p className="text-sm text-slate-600">设置后可在登录页使用手机号和密码登录。</p>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setMessage(null); }}
        placeholder="新密码，至少 8 位"
        className="border rounded px-3 py-2 w-full"
        data-testid="account-password"
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => { setConfirm(e.target.value); setMessage(null); }}
        placeholder="再次输入新密码"
        className="border rounded px-3 py-2 w-full"
        data-testid="account-password-confirm"
      />
      <button
        disabled={!canSubmit}
        onClick={() => setAccountPassword.mutate({ password })}
        className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50"
        data-testid="account-password-submit"
      >
        {setAccountPassword.isPending ? "保存中..." : "保存密码"}
      </button>
      {password && confirm && password !== confirm && <p className="text-sm text-red-600">两次输入的密码不一致</p>}
      {message && <p className="text-sm text-slate-600" data-testid="account-password-message">{message}</p>}
    </section>
  );
}
