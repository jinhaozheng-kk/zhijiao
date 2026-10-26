"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { PersonaPicker } from "@/components/PersonaPicker";
import { GradePicker } from "@/components/GradePicker";
import type { Persona, GradeLevel } from "@zhijiao/domain";

export default function RegisterPage() {
  const router = useRouter();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [grade, setGrade] = useState<GradeLevel | null>(null);
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const currentYear = new Date().getFullYear();

  const info = trpc.auth.registerInfo.useQuery(undefined, { retry: false });
  const register = trpc.auth.register.useMutation({
    onSuccess: (r) => router.push(r.defaultRoute),
  });

  if (info.isLoading) return <p className="p-8">加载中...</p>;
  if (info.error) return <p className="p-8 text-red-600">{info.error.message}</p>;

  return (
    <main className="mx-auto max-w-md p-8 space-y-4">
      <h1 className="text-2xl font-bold">完善注册信息</h1>
      <PersonaPicker value={persona} onChange={setPersona} />
      {persona === "STUDENT" && <GradePicker value={grade} onChange={setGrade} />}
      {persona === "STUDENT" && (
        <label className="block space-y-1">
          <span className="text-sm text-slate-700">出生年份</span>
          <input
            type="number"
            inputMode="numeric"
            min={1990}
            max={currentYear}
            value={birthYear ?? ""}
            onChange={(e) => setBirthYear(e.target.value ? Number(e.target.value) : null)}
            placeholder="例如 2013"
            className="border rounded px-3 py-2 w-full"
            data-testid="register-birthyear"
          />
        </label>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="昵称（可选）" className="border rounded px-3 py-2 w-full" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="登录密码（可选，至少 8 位）"
        className="border rounded px-3 py-2 w-full"
        data-testid="register-password"
      />
      <button
        disabled={!persona || (persona === "STUDENT" && (!grade || !birthYear)) || (password.length > 0 && password.length < 8) || register.isPending}
        onClick={() => register.mutate({ persona: persona!, gradeLevel: grade ?? undefined, birthYear: birthYear ?? undefined, name: name || undefined, password: password || undefined })}
        className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
        data-testid="register-submit"
      >
        {register.isPending ? "提交中..." : "完成注册"}
      </button>
      {register.error && <p className="text-red-600 text-sm">{register.error.message}</p>}
    </main>
  );
}
