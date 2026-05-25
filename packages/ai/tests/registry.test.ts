import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ensurePromptInDb,
  fingerprintOf,
  loadPrompt,
  PromptVersionConflictError,
  type LoadedPrompt,
} from "../src/registry.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error("registry.test.ts: DATABASE_URL must come from vitest.config.ts `test.env` (plan §Task -1)");
}
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

describe("PromptRegistry", () => {
  it("loads tutoring v1 prompt from disk", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(p.name).toBe("tutoring");
    expect(p.version).toBe("v1");
    expect(p.body).toContain("中国 K12");
    expect(p.body).toContain("{{questionStem}}");
    expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprint is stable for identical content", () => {
    expect(fingerprintOf("hello")).toBe(fingerprintOf("hello"));
    expect(fingerprintOf("hello")).not.toBe(fingerprintOf("hello "));
  });

  it("interpolates {{var}} placeholders", async () => {
    const p = await loadPrompt("tutoring", "v1");
    const filled = p.interpolate({ questionStem: "解 2x+5=13", studentGrade: "G8" });
    expect(filled).toContain("解 2x+5=13");
    expect(filled).toContain("G8");
    expect(filled).not.toContain("{{questionStem}}");
  });

  it("throws when an interpolation variable is missing", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(() => p.interpolate({ questionStem: "x" } as never)).toThrow(/studentGrade/);
  });
});

describe("ensurePromptInDb", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function fakePrompt(body: string, name = "registry-test", version = "v1"): LoadedPrompt {
    return {
      name,
      version,
      body,
      fingerprint: fingerprintOf(body),
      interpolate: () => body,
    };
  }

  it("creates a row when none exists, returns same id on second call with identical fingerprint", async () => {
    const p = fakePrompt("hello world");
    const id1 = await ensurePromptInDb(prisma, p);
    const id2 = await ensurePromptInDb(prisma, p);
    expect(id1).toBe(id2);

    const rows = await prisma.promptTemplate.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("hello world");
  });

  it("concurrent first registration of the same prompt converges to one row", async () => {
    const p = fakePrompt("race body", "registry-race", "v1");
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => ensurePromptInDb(prisma, p)),
    );

    expect(new Set(ids).size).toBe(1);
    const rows = await prisma.promptTemplate.findMany({
      where: { name: "registry-race", version: "v1" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(ids[0]);
  });

  it("throws PromptVersionConflictError when (name,version) row exists with different fingerprint", async () => {
    const original = fakePrompt("first body");
    await ensurePromptInDb(prisma, original);

    const tampered = fakePrompt("DIFFERENT BODY");  // same name+version, different content
    await expect(ensurePromptInDb(prisma, tampered)).rejects.toBeInstanceOf(
      PromptVersionConflictError,
    );

    // DB body still the original — was NOT overwritten
    const row = await prisma.promptTemplate.findUniqueOrThrow({
      where: { name_version: { name: "registry-test", version: "v1" } },
    });
    expect(row.body).toBe("first body");
  });

  // 回归测试：fingerprint 不再是全表唯一（Fix 8）。两个不同 (name, version) 的 prompt
  // 即使内容完全相同（→ 相同 fingerprint）也必须能共存。如果未来有人把 @unique 加回到
  // schema 的 fingerprint 字段上，这个测试会立刻报警。
  it("allows two different (name, version) rows to share an identical fingerprint", async () => {
    const sharedBody = "identical body across two distinct prompts";
    const a = fakePrompt(sharedBody, "shared-fp-a", "v1");
    const b = fakePrompt(sharedBody, "shared-fp-b", "v1");
    expect(a.fingerprint).toBe(b.fingerprint);

    const idA = await ensurePromptInDb(prisma, a);
    const idB = await ensurePromptInDb(prisma, b);
    expect(idA).not.toBe(idB);

    const rows = await prisma.promptTemplate.findMany({
      where: { fingerprint: a.fingerprint },
      orderBy: { name: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["shared-fp-a", "shared-fp-b"]);
  });
});
