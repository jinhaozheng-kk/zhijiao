import { describe, it, expect } from "vitest";
import {
  buildAccessCookie, buildRefreshCookie, buildRegisterCookie, buildWxStateCookie,
  clearCookie, COOKIE_AT, COOKIE_RT, COOKIE_REGISTER, COOKIE_WX_STATE,
} from "../src/cookies.js";

describe("cookies", () => {
  it("access cookie 用 __Host- 前缀 + Path=/ + Lax + Max-Age=900", () => {
    const c = buildAccessCookie("abc");
    expect(c).toMatch(/^__Host-zj_at=abc/);
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=900");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
  });
  it("refresh cookie 不带 __Host-，Path=/api/auth + Strict", () => {
    const c = buildRefreshCookie("xyz");
    expect(c).toMatch(/^zj_rt=xyz/);
    expect(c).not.toMatch(/^__Host-/);
    expect(c).toContain("Path=/api/auth");
    expect(c).toContain("SameSite=Strict");
  });
  it("register / wx state cookies 都用 __Host- + Path=/", () => {
    expect(buildRegisterCookie("n")).toContain("Path=/");
    expect(buildRegisterCookie("n")).toMatch(/^__Host-zj_register_token=/);
    expect(buildWxStateCookie("s")).toMatch(/^__Host-zj_wx_state=/);
  });
  it("clearCookie Max-Age=0 同 path", () => {
    expect(clearCookie(COOKIE_RT, "/api/auth")).toContain("Max-Age=0");
    expect(clearCookie(COOKIE_AT, "/")).toContain("Path=/");
  });
});
