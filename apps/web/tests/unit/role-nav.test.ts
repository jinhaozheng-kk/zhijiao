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
    ]);
  });

  it("returns teacher nav with Plan 17 and 18 preview entries", () => {
    expect(navForRole("TEACHER").map((item) => item.label)).toEqual([
      "班级",
      "作业",
      "学生",
      "AI 出卷",
      "AI 课件",
    ]);
  });

  it("returns parent nav", () => {
    expect(navForRole("PARENT").map((item) => item.label)).toEqual([
      "孩子",
      "学情",
      "隐私",
    ]);
  });

  it("teacher nav anchors into the class workspace when a classroom is known", () => {
    const items = navForRole("TEACHER", "cls-1");
    expect(items.find((i) => i.label === "作业")?.href).toBe(
      "/teacher/classes/cls-1#assignments",
    );
    expect(items.find((i) => i.label === "学生")?.href).toBe(
      "/teacher/classes/cls-1#students",
    );
    expect(items.find((i) => i.label === "AI 出卷")?.href).toBe(
      "/teacher/classes/cls-1#ai-paper",
    );
  });

  it("teacher nav falls back to /teacher with no classroom", () => {
    expect(navForRole("TEACHER").every((i) => i.href.startsWith("/teacher"))).toBe(
      true,
    );
    expect(navForRole("TEACHER").find((i) => i.label === "作业")?.href).toBe(
      "/teacher",
    );
  });
});
