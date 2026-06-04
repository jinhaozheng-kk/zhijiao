"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { SkeletonList } from "@/components/ui/skeleton";
import { paperStatusLabel } from "@/lib/paper-copy";

export function PaperListView() {
  const q = trpc.paper.list.useQuery();

  if (q.isLoading) return <SkeletonList rows={4} />;
  if (q.isError)
    return <StatePanel title="加载失败" description="请稍后再试。" />;
  if (!q.data || q.data.length === 0)
    return (
      <StatePanel
        title="还没有试卷，去新建"
        description="按年级、知识点、题型和难度生成练习卷，并带答案解析与双向细目表。"
        action={
          <Link
            href="/teacher/papers/new"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            新建试卷
          </Link>
        }
      />
    );

  return (
    <section
      className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200"
      data-testid="paper-list"
    >
      <div className="divide-y">
        {q.data.map((paper) => (
          <Link
            key={paper.id}
            href={`/teacher/papers/${paper.id}`}
            className="grid gap-3 px-5 py-4 transition hover:bg-slate-50 md:grid-cols-[1fr_auto]"
            data-testid={`paper-row-${paper.id}`}
          >
            <div>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {paper._count.items} 题 &middot;{" "}
                {new Date(paper.createdAt).toLocaleDateString("zh-CN")}
              </p>
            </div>
            <div className="flex items-center">
              <StatusPill tone={paper.status === "READY" ? "green" : "slate"}>
                {paperStatusLabel(paper.status as "DRAFT" | "READY")}
              </StatusPill>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
