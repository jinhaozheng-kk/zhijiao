"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { SkeletonList } from "@/components/ui/skeleton";
import { coursewareStatusLabel } from "@/lib/courseware-copy";
import { gradeLevelLabel, type GradeLevel } from "@/lib/paper-copy";

export function CoursewareListView() {
  const q = trpc.courseware.list.useQuery();

  if (q.isLoading) return <SkeletonList rows={4} />;
  if (q.isError)
    return <StatePanel title="加载失败" description="请稍后再试。" />;
  if (!q.data || q.data.length === 0)
    return (
      <StatePanel
        title="还没有课件，去新建"
        description="按年级与知识点生成五段结构化课件，可预览、分段编辑并打印。"
        action={
          <Link
            href="/teacher/coursewares/new"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            新建课件
          </Link>
        }
      />
    );

  return (
    <section
      className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200"
      data-testid="courseware-list"
    >
      <div className="divide-y">
        {q.data.map((cw) => (
          <Link
            key={cw.id}
            href={`/teacher/coursewares/${cw.id}`}
            className="grid gap-3 px-5 py-4 transition hover:bg-slate-50 md:grid-cols-[1fr_auto]"
            data-testid={`courseware-row-${cw.id}`}
          >
            <div>
              <h2 className="font-medium">{cw.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {cw.gradeLevel ? `${gradeLevelLabel(cw.gradeLevel as GradeLevel)} · ` : ""}
                {new Date(cw.createdAt).toLocaleDateString("zh-CN")}
              </p>
            </div>
            <div className="flex items-center">
              <StatusPill tone={cw.status === "READY" ? "green" : "slate"}>
                {coursewareStatusLabel(cw.status as "DRAFT" | "READY")}
              </StatusPill>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
