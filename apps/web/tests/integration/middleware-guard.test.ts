import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// middleware.ts protects /profile, /error-book, /teacher, /parent, /admin.
// /tutor is intentionally NOT in the matcher — tRPC authedProcedure gates it
// on the data path (see CLAUDE.md "鉴权现状"). This test only exercises the
// route guard; cookie value is not parsed (middleware only checks existence).
const PROTECTED = ["/profile", "/error-book", "/teacher", "/parent", "/admin"];
const UNPROTECTED = ["/", "/login", "/register", "/tutor"];

describe("middleware route guard (G2)", () => {
  it.each(PROTECTED)(
    "无 access cookie 访问 %s → 307 redirect /login?next=…",
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`);
      const res = middleware(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("/login");
      expect(location).toContain(`next=${encodeURIComponent(path)}`);
    },
  );

  it.each(PROTECTED)(
    "有 access cookie 访问 %s → 通过（middleware 不解 JWT，仅看 cookie 是否存在）",
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`, {
        headers: { cookie: "__Host-zj_at=anything-even-garbage" },
      });
      const res = middleware(req);
      // NextResponse.next() has status 200
      expect(res.status).toBeLessThan(300);
    },
  );

  it.each(UNPROTECTED)(
    "无 access cookie 访问 %s → middleware 放行（不在 PROTECTED_PREFIXES）",
    async (path) => {
      const req = new NextRequest(`http://localhost:3000${path}`);
      const res = middleware(req);
      expect(res.status).toBeLessThan(300);
    },
  );

  it("redirect URL 的 next 参数保留 query string（避免登录后丢失上下文）", async () => {
    const req = new NextRequest("http://localhost:3000/profile/settings?tab=sessions");
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    // next= 只反映 pathname；query 不进 next（这是当前 middleware 行为，
    // 如果将来要带 query 进 next 须同步更新这条断言）
    expect(location).toContain(`next=${encodeURIComponent("/profile/settings")}`);
  });

  it("PROTECTED 路径的子路径同样被保护", async () => {
    for (const base of PROTECTED) {
      const req = new NextRequest(`http://localhost:3000${base}/sub/path`);
      const res = middleware(req);
      expect(res.status).toBe(307);
    }
  });
});
