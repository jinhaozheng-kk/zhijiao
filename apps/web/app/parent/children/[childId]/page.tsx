import { ChildPortrait } from "./child-portrait";

export default function ChildPage({ params }: { params: { childId: string } }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">孩子学情</h1>
      <div className="mt-6">
        <ChildPortrait childId={params.childId} />
      </div>
    </main>
  );
}
