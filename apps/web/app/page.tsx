import Link from "next/link";

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">智教</h1>
      <p className="mt-2 text-slate-600">一道题，学会一类题。</p>
      <div className="mt-8">
        <Link
          href="/tutor"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
          data-testid="cta-tutor"
        >
          试问一道题 →
        </Link>
      </div>
    </main>
  );
}
