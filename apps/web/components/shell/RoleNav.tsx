import type { Persona } from "@prisma/client";
import Link from "next/link";

export type NavItem = { label: string; href: string; preview?: boolean };

export function navForRole(role: Persona): NavItem[] {
  if (role === "STUDENT") {
    return [
      { label: "答疑", href: "/tutor" },
      { label: "错题本", href: "/error-book" },
      { label: "作业", href: "/assignments" },
      { label: "学情", href: "/portrait" },
    ];
  }

  if (role === "TEACHER") {
    return [
      { label: "班级", href: "/teacher" },
      { label: "作业", href: "/teacher" },
      { label: "学生", href: "/teacher" },
      { label: "AI 出卷", href: "/teacher#ai-paper", preview: true },
      { label: "AI 课件", href: "/teacher#ai-courseware", preview: true },
    ];
  }

  return [
    { label: "孩子", href: "/parent" },
    { label: "学情", href: "/parent" },
    { label: "隐私", href: "/account/privacy" },
  ];
}

export function RoleNav({ role }: { role: Persona }) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
      {navForRole(role).map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-950 hover:text-white"
        >
          {item.label}
          {item.preview ? <span className="ml-1 text-[10px] opacity-70">预览</span> : null}
        </Link>
      ))}
    </nav>
  );
}
