import { describe, it, expect } from "vitest";
import { createContext } from "../../server/context.js";

function mkReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

async function ctxFrom(headers: Record<string, string>) {
  return createContext({
    req: mkReq(headers),
    resHeaders: new Headers(),
    info: {} as never,
  });
}

describe("createContext — Plan 3 additions", () => {
  it("mints a fresh requestId (UUID v4) when X-Request-Id is absent", async () => {
    const ctx = await ctxFrom({});
    expect(ctx.requestId).toBeTruthy();
    // Node randomUUID() always returns canonical UUID v4 form
    expect(ctx.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("honours the upstream X-Request-Id header verbatim", async () => {
    const ctx = await ctxFrom({ "x-request-id": "trace-abc-123" });
    expect(ctx.requestId).toBe("trace-abc-123");
  });

  it("requestId is unique per call (two consecutive contexts differ)", async () => {
    const a = await ctxFrom({});
    const b = await ctxFrom({});
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("auth is null + isMinor lookup is skipped when no access cookie is present", async () => {
    const ctx = await ctxFrom({});
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("NO_SESSION");
  });

  // The positive isMinor path requires a real signed access token + Session
  // row + User row; covered by integration tests in wallet-*.test.ts (Task 10)
  // and charged-procedure-*.test.ts (Task 12) where the full fixture exists.
});
