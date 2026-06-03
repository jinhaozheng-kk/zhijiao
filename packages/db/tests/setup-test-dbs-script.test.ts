import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("setup-test-dbs script", () => {
  const script = readFileSync(
    join(process.cwd(), "scripts", "setup-test-dbs.ts"),
    "utf8",
  );

  it("selects the pnpm executable by platform for Linux CI compatibility", () => {
    expect(script).toContain('process.platform === "win32"');
    expect(script).toContain('"pnpm.cmd"');
    expect(script).toContain('"pnpm"');
  });

  it("does not shell out through a hardcoded pnpm.cmd migrate command", () => {
    expect(script).not.toContain('execSync(`pnpm.cmd --filter @zhijiao/db db:migrate:deploy`');
  });
});
