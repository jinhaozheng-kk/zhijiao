import Link from "next/link";
import { ReviewView } from "./review-view";

export default function ReviewPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="text-sm">
        <Link href="/error-book" className="text-slate-500 hover:underline">
          ← 返回错题本
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-bold">复习</h1>
      <ReviewView />
    </main>
  );
}
