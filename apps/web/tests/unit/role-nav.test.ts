import { describe, expect, it } from "vitest";
import { navForRole } from "@/components/shell/RoleNav";

describe("role navigation", () => {
  it("returns student nav", () => {
    expect(navForRole("STUDENT").map((item) => item.label)).toEqual([
      "答疑",
      "错题本",
      "训练",
      "作业",
      "学情",
      "账号",
    ]);
  });

  it("returns teacher nav with AI paper and AI courseware as real direct entries", () => {
    expect(navForRole("TEACHER").map((item) => item.label)).toEqual([
      "班级",
      "作业",
      "学生",
      "AI 出卷",
      "AI 课件",
      "账号",
    ]);
    expect(navForRole("TEACHER").find((i) => i.label === "AI 出卷")).toEqual({
      label: "AI 出卷",
      href: "/teacher/papers",
    });
    expect(navForRole("TEACHER").find((i) => i.label === "AI 课件")).toEqual({
      label: "AI 课件",
      href: "/teacher/coursewares",
    });
  });

  it("returns parent nav", () => {
    expect(navForRole("PARENT").map((item) => item.label)).toEqual([
      "孩子",
      "学情",
      "账号",
      "隐私",
    ]);
  });

  it("teacher nav anchors class-local sections and links paper generation directly", () => {
    const items = navForRole("TEACHER", "cls-1");
    expect(items.find((i) => i.label === "作业")?.href).toBe(
      "/teacher/classes/cls-1#assignments",
    );
    expect(items.find((i) => i.label === "学生")?.href).toBe(
      "/teacher/classes/cls-1#students",
    );
    expect(items.find((i) => i.label === "AI 出卷")?.href).toBe(
      "/teacher/papers",
    );
  });

  it("teacher nav falls back to /teacher with no classroom", () => {
    // 教师导航里的「账号」是指向 /account/security 的全局入口，其余均为教师域链接。
    expect(
      navForRole("TEACHER").every(
        (i) => i.href.startsWith("/teacher") || i.href.startsWith("/account"),
      ),
    ).toBe(true);
    expect(navForRole("TEACHER").find((i) => i.label === "作业")?.href).toBe(
      "/teacher",
    );
  });
});
