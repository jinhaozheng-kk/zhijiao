import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { createSession, COOKIE_RT } from "@zhijiao/auth";
import { Persona } from "@prisma/client";
import { POST as refreshPOST } from "@/app/api/auth/refresh/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";

process.env.ACCESS_JWT_SECRET = "test-secret-at-least-32-bytes-long-aaaa";
// Route handlers import the @zhijiao/db production singleton which reads DATABASE_URL.
// Point it at the test DB so the singleton connects to the right place.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/zhijiao_test";
// Clear any cached singleton so it re-initialises with DATABASE_URL above.
(globalThis as Record<string, unknown>)["__zhijiaoPrisma"] = undefined;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

async function seedUser() {
  return prisma.user.create({ data: { persona: Persona.STUDENT, isMinor: false } });
}

function reqWithCookie(name: string, value: string) {
  return new Request("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: { cookie: `${name}=${encodeURIComponent(value)}` },
  });
}

describe("/api/auth/refresh", () => {
  it("happy path：rotate 颁发新 zj_at + zj_rt", async () => {
    const u = await seedUser();
    const { refreshToken } = await createSession(prisma, u.id, {});
    const res = await refreshPOST(reqWithCookie(COOKIE_RT, refreshToken));
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("__Host-zj_at="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("zj_rt="))).toBe(true);
  });

  it("用 rotated 后的旧 refresh 再 refresh → 401 REUSE_DETECTED + 清 cookie", async () => {
    const u = await seedUser();
    const { refreshToken: rt1 } = await createSession(prisma, u.id, {});
    await refreshPOST(reqWithCookie(COOKIE_RT, rt1));   // rotate
    const res2 = await refreshPOST(reqWithCookie(COOKIE_RT, rt1));
    expect(res2.status).toBe(401);
    const body = await res2.json();
    expect(body.reason).toBe("REUSE_DETECTED");
    const sets = res2.headers.getSetCookie();
    expect(sets.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});

describe("/api/auth/logout", () => {
  it("有 zj_rt → revoke session + 清 cookie", async () => {
    const u = await seedUser();
    const { refreshToken, sessionId } = await createSession(prisma, u.id, {});
    const res = await logoutPOST(reqWithCookie(COOKIE_RT, refreshToken));
    expect(res.status).toBe(200);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.revokedReason).toBe("USER_LOGOUT");
    const sets = res.headers.getSetCookie();
    expect(sets.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  it("无 cookie 也安全返 200 + 清 cookie", async () => {
    const res = await logoutPOST(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
  });
});
