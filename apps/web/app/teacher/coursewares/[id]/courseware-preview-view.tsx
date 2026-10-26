"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { SkeletonList } from "@/components/ui/skeleton";
import { MathText } from "@/components/math-text";
import {
  coursewareStatusLabel,
  coursewareSectionTypeLabel,
  type CoursewareSectionTypeValue,
} from "@/lib/courseware-copy";

type Section = {
  id: string;
  position: number;
  type: string;
  title: string;
  contentMd: string;
};

function SectionCard({
  coursewareId,
  section,
  disabled,
}: {
  coursewareId: string;
  section: Section;
  disabled: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [contentMd, setContentMd] = useState(section.contentMd);
  const update = trpc.courseware.updateSection.useMutation({
    onSuccess: () => {
      setEditing(false);
      utils.courseware.get.invalidate({ coursewareId });
    },
  });

  return (
    <article
      className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200"
      data-testid={`section-${section.type}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {coursewareSectionTypeLabel(section.type as CoursewareSectionTypeValue)}
          </span>
          <h3 className="font-medium">{section.title}</h3>
        </div>
        {!disabled && !editing && (
          <button
            type="button"
            onClick={() => {
              setContentMd(section.contentMd);
              setEditing(true);
            }}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            编辑
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <textarea
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-7"
            data-testid={`section-textarea-${section.type}`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={update.isPending || contentMd.trim().length === 0}
              onClick={() =>
                update.mutate({ coursewareId, sectionId: section.id, contentMd })
              }
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {update.isPending ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-900">
          <MathText text={section.contentMd} />
        </p>
      )}
    </article>
  );
}

export function CoursewarePreviewView({ coursewareId }: { coursewareId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.courseware.get.useQuery({ coursewareId }, { retry: false });
  const markReady = trpc.courseware.markReady.useMutation({
    onSuccess: () => utils.courseware.get.invalidate({ coursewareId }),
  });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return (
      <StatePanel
        title="课件加载失败"
        description="课件不存在，或当前账号没有访问权限。"
      />
    );
  }
  if (!query.data) return null;

  const courseware = query.data.courseware;
  const disabled = courseware.status === "READY";

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{courseware.title}</h2>
            <StatusPill tone={disabled ? "green" : "slate"}>
              {coursewareStatusLabel(courseware.status as "DRAFT" | "READY")}
            </StatusPill>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/teacher/coursewares/${courseware.id}/print`}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              打印 / 导出
            </Link>
            <button
              type="button"
              disabled={disabled || markReady.isPending}
              onClick={() => markReady.mutate({ coursewareId })}
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disabled ? "已确认完成" : "确认完成"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {courseware.sections.map((section) => (
          <SectionCard
            key={section.id}
            coursewareId={courseware.id}
            section={section}
            disabled={disabled}
          />
        ))}
      </section>
    </div>
  );
}
