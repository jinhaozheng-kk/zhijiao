import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { PaperPreviewView } from "./paper-preview-view";

export const dynamic = "force-dynamic";

export default function PaperPreviewPage({
  params,
}: {
  params: { paperId: string };
}) {
  return (
    <AppShell>
      <div className="text-sm">
        <Link href="/teacher/papers" className="text-slate-500 hover:underline">
          返回试卷列表
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader
          eyebrow="AI 出卷"
          title="试卷预览"
          description="检查题目、答案解析与双向细目表，必要时调整分值或删题。"
        />
      </div>
      <div className="mt-6">
        <PaperPreviewView paperId={params.paperId} />
      </div>
    </AppShell>
  );
}
