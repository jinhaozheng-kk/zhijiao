import { PrivacyView } from "./privacy-view";
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-8 text-slate-900">
      <h1 className="text-2xl font-bold">数据与隐私</h1>
      <PrivacyView />
    </main>
  );
}
