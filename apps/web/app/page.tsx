import Link from "next/link";
import { isDemoModeEnabled } from "@/server/demo/config";

export const dynamic = "force-dynamic";

export default function Page() {
  const demo = isDemoModeEnabled();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-slate-500">AI K12 学教平台</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight">智教</h1>
      <p className="mt-5 text-lg leading-8 text-slate-600">一道题，学会一类题。</p>
      <div className="mt-8">
        <Link
          href={demo ? "/demo" : "/login"}
          className="inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          data-testid="cta-primary"
        >
          {demo ? "进入演示中心" : "登录使用"}
        </Link>
      </div>
    </main>
  );
}
