import { describe, expect, it } from "vitest";
import { checkReadiness } from "@/server/lib/readiness";

describe("checkReadiness", () => {
  it("reports ready when database and redis checks pass", async () => {
    const result = await checkReadiness({
      now: () => new Date("2026-06-04T00:00:00.000Z"),
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined,
    });

    expect(result).toEqual({
      ok: true,
      service: "zhijiao-web",
      checkedAt: "2026-06-04T00:00:00.000Z",
      checks: {
        database: { ok: true },
        redis: { ok: true },
      },
    });
  });

  it("reports not ready when a dependency check fails", async () => {
    const result = await checkReadiness({
      now: () => new Date("2026-06-04T00:00:00.000Z"),
      checkDatabase: async () => undefined,
      checkRedis: async () => {
        throw new Error("redis://secret-host:6379 refused connection");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.database).toEqual({ ok: true });
    expect(result.checks.redis).toEqual({
      ok: false,
      reason: "dependency check failed",
    });
  });
});
