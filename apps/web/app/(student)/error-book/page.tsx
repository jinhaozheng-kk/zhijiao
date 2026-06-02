import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatePanel } from "@/components/ui/state-panel";
import { ErrorBookList } from "./error-book-list";

export const dynamic = "force-dynamic";

export default function ErrorBookPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="学生学习"
        title="错题本"
        description="把答错的题留下来，按错因分类、按节奏复习。"
      />
      <div className="mt-6">
        <Suspense fallback={<StatePanel title="加载中..." />}>
          <ErrorBookList />
        </Suspense>
      </div>
    </AppShell>
  );
}
