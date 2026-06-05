import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { CoursewareListView } from "./courseware-list-view";

export const dynamic = "force-dynamic";

export default function TeacherCoursewaresPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="AI 课件"
        title="课件列表"
        description="按年级与知识点生成课堂导入、讲解结构、例题、易错点和课堂练习五段结构化课件。"
        action={
          <Link
            href="/teacher/coursewares/new"
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            新建课件
          </Link>
        }
      />
      <div className="mt-8">
        <CoursewareListView />
      </div>
    </AppShell>
  );
}
