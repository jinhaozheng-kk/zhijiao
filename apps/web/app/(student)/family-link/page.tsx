import { FamilyLinkView } from "./family-link-view";

export default function FamilyLinkPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">绑定家长</h1>
      <div className="mt-6">
        <FamilyLinkView />
      </div>
    </main>
  );
}
