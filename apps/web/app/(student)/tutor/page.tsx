import { TutorForm } from "@/components/TutorForm";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";

export const dynamic = "force-dynamic";

export default function TutorPage({
  searchParams,
}: {
  searchParams?: { demo?: string };
}) {
  const demo = isDemoModeEnabled() && searchParams?.demo === "1";

  return (
    <AppShell>
      <PageHeader
        eyebrow="学生学习"
        title="AI 答疑"
        description="先看提示和方法，再展开完整讲解。适合把一道题变成一类题。"
      />
      <div className="mt-8 max-w-3xl">
        <TutorForm demo={demo} />
      </div>
    </AppShell>
  );
}
