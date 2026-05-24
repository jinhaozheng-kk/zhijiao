import Link from "next/link";
import { EntryDetail } from "./entry-detail";

export default function EntryDetailPage({
  params,
}: {
  params: { entryId: string };
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="text-sm">
        <Link href="/error-book" className="text-slate-500 hover:underline">
          ← 返回错题本
        </Link>
      </div>
      <EntryDetail entryId={params.entryId} />
    </main>
  );
}
