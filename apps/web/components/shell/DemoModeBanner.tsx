import Link from "next/link";

export function DemoModeBanner() {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2 text-sm text-slate-600">
        <span>演示模式 · 初二数学三端闭环</span>
        <Link href="/demo" className="font-medium text-slate-950">
          返回演示中心
        </Link>
      </div>
    </div>
  );
}
