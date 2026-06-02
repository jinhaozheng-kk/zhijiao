import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { COOKIE_AT, COOKIE_RT } from "@zhijiao/auth";

const originalDemoMode = process.env.DEMO_MODE;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
  await resetDb();
  (process.env as { NODE_ENV?: string }).NODE_ENV = originalNodeEnv ?? "test";
  vi.resetModules();
});

afterAll(async () => {
  if (originalDemoMode === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = originalDemoMode;
  }
  if (originalNodeEnv === undefined) {
    delete (process.env as { NODE_ENV?: string }).NODE_ENV;
  } else {
    (process.env as { NODE_ENV?: string }).NODE_ENV = originalNodeEnv;
  }
  await prisma.$disconnect();
});

async function getRouteWithDemoMode(demoMode: "0" | "1") {
  process.env.DEMO_MODE = demoMode;
  return import("@/app/api/demo/enter/route");
}

describe("/api/demo/enter", () => {
  it("returns 404 when demo mode is disabled", async () => {
    const { GET } = await getRouteWithDemoMode("0");

    const res = await GET(
      new Request("http://localhost/api/demo/enter?role=student"),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "DEMO_MODE_DISABLED",
    });
  });

  it("returns 400 for an unknown role when demo mode is enabled", async () => {
    const { GET } = await getRouteWithDemoMode("1");

    const res = await GET(
      new Request("http://localhost/api/demo/enter?role=admin"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "DEMO_ROLE_INVALID",
    });
  });

  it("returns 404 in production even when demo mode is enabled", async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const { GET } = await getRouteWithDemoMode("1");

    const res = await GET(
      new Request("http://localhost/api/demo/enter?role=student"),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "DEMO_MODE_DISABLED",
    });
  });

  it("seeds demo data and redirects a student with normal auth cookies", async () => {
    const [{ GET }, { DEMO_IDS, DEMO_TARGETS }] = await Promise.all([
      getRouteWithDemoMode("1"),
      import("@/server/demo/config"),
    ]);

    const before = await prisma.user.count({
      where: { id: DEMO_IDS.studentUserId },
    });
    expect(before).toBe(0);

    const res = await GET(
      new Request("http://localhost/api/demo/enter?role=student", {
        headers: {
          "x-forwarded-for": "203.0.113.10, 10.0.0.2",
          "user-agent": "vitest-demo-entry",
        },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `http://localhost${DEMO_TARGETS.student}`,
    );

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((cookie) => cookie.startsWith(`${COOKIE_AT}=`))).toBe(
      true,
    );
    expect(setCookies.some((cookie) => cookie.startsWith(`${COOKIE_RT}=`))).toBe(
      true,
    );

    await expect(
      prisma.user.count({ where: { id: DEMO_IDS.studentUserId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.studentAssignment.count({
        where: { studentUserId: DEMO_IDS.studentUserId },
      }),
    ).resolves.toBe(1);

    const session = await prisma.session.findFirstOrThrow({
      where: { userId: DEMO_IDS.studentUserId },
    });
    expect(session.ipCreated).toBe("203.0.113.10");
    expect(session.userAgent).toBe("vitest-demo-entry");
    expect(session.revokedAt).toBeNull();
  });
});
