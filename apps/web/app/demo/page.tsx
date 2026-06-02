import { isDemoModeEnabled } from "@/server/demo/config";

export const dynamic = "force-dynamic";

const roles = [
  {
    href: "/api/demo/enter?role=student",
    title: "学生体验",
    eyebrow: "从不会题到错题巩固",
    body: "体验提示式讲解、错因分析、错题本和变式训练。",
  },
  {
    href: "/api/demo/enter?role=teacher",
    title: "教师体验",
    eyebrow: "从班级薄弱点到分层作业",
    body: "查看初二 3 班诊断，生成分层作业，批改并回流错题。",
  },
  {
    href: "/api/demo/enter?role=parent",
    title: "家长体验",
    eyebrow: "简化学情反馈",
    body: "查看孩子近期掌握情况和巩固方向，不展示排名。",
  },
] as const;

export default function DemoPage() {
  if (!isDemoModeEnabled()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6">
        <section className="rounded-lg bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Demo mode</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            演示中心未开启
          </h1>
          <p className="mt-3 text-slate-600">请在本地演示环境启用 DEMO_MODE=1。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-950">
      <section className="mx-auto max-w-6xl">
        <p className="text-sm font-medium text-slate-500">初二数学 · 三端闭环</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight">
          智教演示中心
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          以一次函数与方程关系为例，体验学生学习、教师教学、家长反馈三端闭环。
        </p>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {roles.map((role) => (
            // POST form (not a link): entering the demo has side effects
            // (reset data + issue session), so it must not be prefetchable.
            <form
              key={role.title}
              action={role.href}
              method="post"
              className="contents"
            >
              <button
                type="submit"
                className="group rounded-lg bg-white p-7 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="block text-sm font-medium text-slate-500">
                  {role.eyebrow}
                </span>
                <span className="mt-4 block text-2xl font-semibold">
                  {role.title}
                </span>
                <span className="mt-3 block text-sm leading-6 text-slate-600">
                  {role.body}
                </span>
                <span className="mt-8 inline-flex text-sm font-medium text-slate-950">
                  进入体验
                </span>
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
