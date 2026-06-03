import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkReadiness } from "@/server/lib/readiness";

vi.mock("@/server/lib/readiness", () => ({
  checkReadiness: vi.fn(),
}));

const mockedCheckReadiness = vi.mocked(checkReadiness);

describe("GET /readiness", () => {
  beforeEach(() => {
    mockedCheckReadiness.mockReset();
  });

  it("returns 200 when every dependency is ready", async () => {
    const body = {
      ok: true,
      service: "zhijiao-web" as const,
      checkedAt: "2026-06-04T00:00:00.000Z",
      checks: {
        database: { ok: true },
        redis: { ok: true },
      },
    };
    mockedCheckReadiness.mockResolvedValue(body);

    const { GET } = await import("@/app/readiness/route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("returns 503 when any dependency is not ready", async () => {
    const body = {
      ok: false,
      service: "zhijiao-web" as const,
      checkedAt: "2026-06-04T00:00:00.000Z",
      checks: {
        database: { ok: true },
        redis: { ok: false, reason: "dependency check failed" as const },
      },
    };
    mockedCheckReadiness.mockResolvedValue(body);

    const { GET } = await import("@/app/readiness/route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(body);
  });
});
