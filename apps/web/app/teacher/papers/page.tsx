import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperListView } from "./paper-list-view";

export const dynamic = "force-dynamic";

export default function TeacherPapersPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="AI 出卷"
        title="试卷列表"
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
      <div className="mt-8">
        <PaperListView />
      </div>
    </AppShell>
  );
}
