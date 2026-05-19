import { describe, it, expect } from "vitest";
import { hasPermission, DEFAULT_LOGGED_IN_PERMS, ROLE_PERMISSIONS } from "../src/rbac.js";

describe("rbac (plan 2)", () => {
  it("任何登录用户（空 roles）都拥有 DEFAULT_LOGGED_IN_PERMS", () => {
    for (const p of DEFAULT_LOGGED_IN_PERMS) {
      expect(hasPermission([], p)).toBe(true);
    }
  });

  it("空 roles 没有 OPS / ADMIN 权限", () => {
    expect(hasPermission([], "OPS_PUBLISH_FORECAST")).toBe(false);
    expect(hasPermission([], "ADMIN_MANAGE_USERS")).toBe(false);
  });

  it("OPS role 有 OPS_* 权限但无 ADMIN_*", () => {
    expect(hasPermission(["OPS"], "OPS_CURATE_CONTENT")).toBe(true);
    expect(hasPermission(["OPS"], "ADMIN_MANAGE_USERS")).toBe(false);
  });

  it("ADMIN role 同时有 OPS_* 与 ADMIN_*", () => {
    expect(hasPermission(["ADMIN"], "OPS_PUBLISH_FORECAST")).toBe(true);
    expect(hasPermission(["ADMIN"], "ADMIN_VIEW_AUDIT")).toBe(true);
  });

  it("ROLE_PERMISSIONS 不包含 DEFAULT_LOGGED_IN_PERMS 中的项（避免重复定义）", () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const p of DEFAULT_LOGGED_IN_PERMS) {
        expect(perms).not.toContain(p);
      }
    }
  });
});
