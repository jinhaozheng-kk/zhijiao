import { PortraitView } from "./portrait-view";

export default function PortraitPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">我的学情</h1>
      <p className="mt-1 text-sm text-slate-600">看看自己各知识点的掌握情况，找到下一步重点。</p>
      <div className="mt-6">
        <PortraitView />
      </div>
    </main>
  );
}
