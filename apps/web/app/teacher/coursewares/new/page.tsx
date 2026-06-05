import Link from "next/link";
import { prisma } from "@zhijiao/db";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { CoursewareGenerationForm } from "./courseware-generation-form";

export const dynamic = "force-dynamic";

export default async function NewCoursewarePage() {
  // Single math subject + its KP leaves (Plan 13 4-level tree). Mirror paper/new.
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
          <Link href="/teacher/coursewares" className="text-slate-500 hover:underline">
            返回课件列表
          </Link>
        </div>
        <div className="mt-6">
          <StatePanel
            title="暂无可用知识点"
            description="当前学科还没有可用于课件的知识点，请联系管理员。"
          />
        </div>
      </AppShell>
    );
  }

  const parentIds = new Set(
    subject.knowledgePoints
      .filter((kp) => kp.parentId !== null)
      .map((kp) => kp.parentId as string),
  );
  const leafKps = subject.knowledgePoints.filter((kp) => !parentIds.has(kp.id));
  const kpsForPicker = leafKps.length > 0 ? leafKps : subject.knowledgePoints;

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
          title="新建课件"
          description={`${subject.name} · 选择年级与知识点，AI 将生成导入/讲解/例题/易错点/课堂练习五段课件。`}
        />
      </div>
      <CoursewareGenerationForm
        subjectId={subject.id}
        kps={kpsForPicker.map((kp) => ({ id: kp.id, name: kp.name }))}
      />
    </AppShell>
  );
}
