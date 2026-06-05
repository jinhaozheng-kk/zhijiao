import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { CoursewarePreviewView } from "./courseware-preview-view";

export const dynamic = "force-dynamic";

export default function CoursewarePreviewPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <AppShell>
      <div className="text-sm">
        <Link href="/teacher/coursewares" className="text-slate-500 hover:underline">
          返回课件列表
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader
          eyebrow="AI 课件"
          title="课件预览"
          description="检查五段课件内容，可分段编辑，确认完成后可打印导出。"
        />
      </div>
      <div className="mt-6">
        <CoursewarePreviewView coursewareId={params.id} />
      </div>
    </AppShell>
  );
}
