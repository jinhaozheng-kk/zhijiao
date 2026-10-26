import { SecurityView } from "./security-view";

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-8 text-slate-900">
      <h1 className="text-2xl font-bold">账号安全</h1>
      <SecurityView />
    </main>
  );
}
