import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ensurePromptInDb,
  fingerprintOf,
  loadPrompt,
  PromptVersionConflictError,
  type LoadedPrompt,
} from "../src/registry.js";

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/zhijiao_test";
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
});
