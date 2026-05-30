import { ParentView } from "./parent-view";

export default function ParentHome() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold">家长面板</h1>
      <div className="mt-6">
        <ParentView />
      </div>
    </main>
  );
}
