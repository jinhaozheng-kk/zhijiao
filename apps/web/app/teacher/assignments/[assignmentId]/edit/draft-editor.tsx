"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  assignmentTierLabel,
  questionTypeLabel,
  type AssignmentTierValue,
  type QuestionTypeValue,
} from "@/lib/assignment-copy";
import { trpc } from "@/lib/trpc-client";

interface DraftTier {
  id: string;
  level: AssignmentTierValue;
  title: string;
  rationaleMd: string | null;
  items: Array<{
    id: string;
    position: number;
    stemMd: string;
    type: QuestionTypeValue;
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
      setMessage("草稿已保存。");
      router.refresh();
    },
    onError: (e) => {
      setMessage(null);
      setError(e.message || "作业状态已变化，请刷新后再继续。");
    },
  });
  const publish = trpc.assignment.publish.useMutation({
    onSuccess: () => {
      setError(null);
      setMessage("已发布。");
      router.push(`/teacher/assignments/${assignmentId}`);
    },
    onError: (e) => {
      setMessage(null);
      setError(e.message || "作业状态已变化，请刷新后再继续。");
    },
  });
  const pending = updateDraft.isPending || publish.isPending;
  const isDraft = status === "DRAFT";

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label className="block text-sm font-medium text-slate-700">
          作业标题
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            value={title}
            disabled={!isDraft || pending}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={!isDraft || pending || title.trim().length === 0}
            onClick={() =>
              updateDraft.mutate({ assignmentId, title: title.trim() })
            }
          >
            {updateDraft.isPending ? "保存中..." : "保存草稿"}
          </button>
          <button
            type="button"
            className="rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!isDraft || pending}
            onClick={() => publish.mutate({ assignmentId })}
          >
            {publish.isPending ? "发布中..." : "发布作业"}
          </button>
          {!isDraft && (
            <p className="text-sm text-slate-600">
              已发布作业不可继续编辑。
            </p>
          )}
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </section>

      <section className="space-y-4">
        {tiers.map((tier) => (
          <div key={tier.id} className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b px-4 py-3">
              <h2 className="font-medium">
                {assignmentTierLabel(tier.level)} · {tier.title}
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
                    {questionTypeLabel(item.type)} · 第 {item.position} 题
                  </div>
                  <h3 className="mt-1 font-medium">{item.stemMd}</h3>
                  <p className="mt-2 text-sm text-slate-700">
                    答案：{item.answerMd}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    解析：{item.solutionMd}
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
