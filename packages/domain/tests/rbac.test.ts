import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, hasPermission } from "../src/rbac.js";

describe("RBAC", () => {
  it("STUDENT can ask", () => {
    expect(ROLE_PERMISSIONS.STUDENT).toContain("STUDENT_ASK");
  });

  it("TEACHER can generate paper but cannot publish forecast", () => {
    expect(ROLE_PERMISSIONS.TEACHER).toContain("TEACHER_GEN_PAPER");
    expect(ROLE_PERMISSIONS.TEACHER).not.toContain("OPS_PUBLISH_FORECAST");
  });

  it("ADMIN has all permissions of OPS", () => {
    for (const perm of ROLE_PERMISSIONS.OPS) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(perm);
    }
  });

  it("hasPermission returns true when any of user's roles grants it", () => {
    expect(hasPermission(["STUDENT"], "STUDENT_ASK")).toBe(true);
    expect(hasPermission(["STUDENT"], "TEACHER_GEN_PAPER")).toBe(false);
    expect(hasPermission(["STUDENT", "PARENT"], "PARENT_VIEW_CHILD")).toBe(true);
  });
});
