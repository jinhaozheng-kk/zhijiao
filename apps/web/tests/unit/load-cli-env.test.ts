import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCliEnvFrom } from "@/scripts/load-cli-env";

function makeWorkspace(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhijiao-cli-env-"));
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  const appDir = path.join(root, "apps", "web");
  fs.mkdirSync(appDir, { recursive: true });
  return { root, appDir };
}

describe("loadCliEnvFrom", () => {
  it("loads root .env.local for package CLI scripts without overriding existing env", () => {
    const { appDir } = makeWorkspace({
      ".env.local": "DATABASE_URL=postgresql://from-local\nREDIS_URL=redis://from-local\n",
    });
    const env = { DATABASE_URL: "postgresql://already-set" };

    loadCliEnvFrom(appDir, { env });

    expect(env).toEqual({
      DATABASE_URL: "postgresql://already-set",
      REDIS_URL: "redis://from-local",
    });
  });

  it("falls back to root .env.example only when local env files are absent", () => {
    const { appDir } = makeWorkspace({
      ".env.example": "DATABASE_URL=postgresql://from-example\n",
    });
    const env: Record<string, string> = {};

    loadCliEnvFrom(appDir, { env, nodeEnv: "development" });

    expect(env.DATABASE_URL).toBe("postgresql://from-example");
  });
});
