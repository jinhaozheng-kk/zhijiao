import { describe, it, expect } from "vitest";

describe("billing package smoke", () => {
  it("DATABASE_URL is injected by vitest config (per-pkg test DB)", () => {
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_billing",
    );
  });
});
