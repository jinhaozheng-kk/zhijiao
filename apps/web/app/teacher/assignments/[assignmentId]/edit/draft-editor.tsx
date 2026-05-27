"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

interface DraftTier {
  id: string;
  level: string;
  title: string;
  rationaleMd: string | null;
  items: Array<{
    id: string;
    position: number;
    stemMd: string;
    type: string;
    answerMd: string;
    solutionMd: string;
  }>;
}

export function DraftEditor({
  assignmentId,
  initialTitle,
  status,
  tiers,
}: {
  assignmentId: string;
  initialTitle: string;
  status: string;
  tiers: DraftTier[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateDraft = trpc.assignment.updateDraft.useMutation({
    onSuccess: () => {
      setError(null);
      setMessage("Draft saved.");
      router.refresh();
    },
    onError: (e) => {
      setMessage(null);
      setError(e.message);
    },
  });
  const publish = trpc.assignment.publish.useMutation({
    onSuccess: () => {
      setError(null);
      setMessage("Published.");
      router.push(`/teacher/assignments/${assignmentId}`);
    },
    onError: (e) => {
      setMessage(null);
      setError(e.message);
    },
  });
  const pending = updateDraft.isPending || publish.isPending;
  const isDraft = status === "DRAFT";

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded border bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          Assignment title
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={title}
            disabled={!isDraft || pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
            disabled={!isDraft || pending || title.trim().length === 0}
            onClick={() =>
              updateDraft.mutate({ assignmentId, title: title.trim() })
            }
          >
            {updateDraft.isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!isDraft || pending}
            onClick={() => publish.mutate({ assignmentId })}
          >
            {publish.isPending ? "Publishing..." : "Publish"}
          </button>
          {!isDraft && (
            <p className="text-sm text-slate-600">
              Published assignments are locked.
            </p>
          )}
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </section>

      <section className="space-y-4">
        {tiers.map((tier) => (
          <div key={tier.id} className="overflow-hidden rounded border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="font-medium">
                {tier.level} · {tier.title}
              </h2>
              {tier.rationaleMd && (
                <p className="mt-1 text-sm text-slate-600">
                  {tier.rationaleMd}
                </p>
              )}
            </div>
            <div className="divide-y">
              {tier.items.map((item) => (
                <article key={item.id} className="px-4 py-4">
                  <div className="text-xs uppercase text-slate-500">
                    {item.type} · #{item.position}
                  </div>
                  <h3 className="mt-1 font-medium">{item.stemMd}</h3>
                  <p className="mt-2 text-sm text-slate-700">
                    Answer: {item.answerMd}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Solution: {item.solutionMd}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
