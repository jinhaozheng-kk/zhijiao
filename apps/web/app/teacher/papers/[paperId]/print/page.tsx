import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { PaperPrintView } from "./paper-print-view";

export const dynamic = "force-dynamic";

export default function PaperPrintPage({
  params,
}: {
  params: { paperId: string };
}) {
  return (
    <AppShell>
      <div className="print-hidden">
        <PageHeader
          eyebrow="AI 出卷"
          title="打印试卷"
          description="打印时会隐藏导航与操作按钮，仅保留题卷、答案解析和双向细目表。"
        />
      </div>
      <div className="mt-6 print:mt-0">
        <PaperPrintView paperId={params.paperId} />
      </div>
    </AppShell>
  );
}
