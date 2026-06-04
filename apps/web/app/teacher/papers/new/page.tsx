import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperGenerationForm } from "./paper-generation-form";

export const dynamic = "force-dynamic";

export default async function NewPaperPage() {
  // Load math subject + all its KP leaves (nodes that have no children).
  // Plan 13 established a single math subject with a 4-level tree.
  // We fetch all KPs and pass them as leaf candidates; the user picks KPs
  // from this list. For v1 we include all KPs (not just leaf nodes) so
  // even a small seed set is usable.
  const subject = await prisma.subject.findFirst({
    where: { code: "math" },
    include: {
      knowledgePoints: {
        orderBy: [{ parentId: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!subject || subject.knowledgePoints.length === 0) {
    return (
      <AppShell>
        <div className="text-sm">
          <Link href="/teacher/papers" className="text-slate-500 hover:underline">
            返回试卷列表
          </Link>
        </div>
        <div className="mt-6">
          <StatePanel
            title="暂无可用知识点"
            description="当前学科还没有可用于出卷的知识点，请联系管理员。"
          />
        </div>
      </AppShell>
    );
  }

  // Only pass leaf KPs (those with no children in the tree) so the picker
  // shows the finest-grained granularity. Fall back to all KPs if no leaves found.
  const parentIds = new Set(
    subject.knowledgePoints
      .filter((kp) => kp.parentId !== null)
      .map((kp) => kp.parentId as string)
  );
  const leafKps = subject.knowledgePoints.filter((kp) => !parentIds.has(kp.id));
  const kpsForPicker = leafKps.length > 0 ? leafKps : subject.knowledgePoints;

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
          title="新建试卷"
          description={`${subject.name} · 选择知识点与题型，AI 将生成练习卷并附答案解析与双向细目表。`}
        />
      </div>
      <PaperGenerationForm
        subjectId={subject.id}
        kps={kpsForPicker.map((kp) => ({ id: kp.id, name: kp.name }))}
      />
    </AppShell>
  );
}
