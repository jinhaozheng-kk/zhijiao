import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { SessionView } from "./session-view";

export const dynamic = "force-dynamic";

export default function TrainingPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="学生学习"
        title="靶向训练"
        description="围绕你的重点巩固方向，把做错过的题再练成一类题。先想方法，再看解析。"
      />
      <div className="mt-6 max-w-3xl">
        <SessionView />
      </div>
    </AppShell>
  );
}
