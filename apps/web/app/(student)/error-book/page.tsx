import { Suspense } from "react";
import { ErrorBookList } from "./error-book-list";

export default function ErrorBookPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">错题本</h1>
      <p className="mt-1 text-sm text-slate-600">
        把答错的题留下来，按错因分类、按节奏复习。
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-slate-500">加载中...</p>}>
          <ErrorBookList />
        </Suspense>
      </div>
    </main>
  );
}
