import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { CoursewarePrintView } from "./courseware-print-view";

export const dynamic = "force-dynamic";

export default function CoursewarePrintPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <AppShell>
      <div className="print-hidden">
        <PageHeader
          eyebrow="AI 课件"
          title="打印课件"
          description="打印时会隐藏导航与操作按钮，仅保留五段课件内容。"
        />
      </div>
      <div className="mt-6 print:mt-0">
        <CoursewarePrintView coursewareId={params.id} />
      </div>
    </AppShell>
  );
}
