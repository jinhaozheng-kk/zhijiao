import { describe, expect, it } from "vitest";
import { afterAll, beforeEach } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "generate-paper.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

function paperStemTemplateKey(stem: string): string {
  return stem
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*(?:第\s*)?\d+\s*[.、．]\s*/u, "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、,.!?;:]/g, "")
    .replace(/\d+(?:\.\d+)?/g, "<num>");
}

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "model_calls" RESTART IDENTITY CASCADE;`,
  );
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`,
  );
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("AiRouter.generatePaper", () => {
  it("returns parsed items, modelCallId, and writes a SUCCESS audit", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-teacher-01",
    });

    const out = await router.generatePaper({
      subject: "数学",
      gradeLevel: "G8",
      kpNames: ["一次函数"],
      sections: [
        { type: "CALCULATION", count: 1 },
        { type: "SINGLE_CHOICE", count: 1 },
      ],
      difficultyRange: [1, 3],
      excludeStems: [],
    });

    expect(out.items.length).toBeGreaterThan(0);
    expect(out.modelCallId).toBeTruthy();
    expect(out.items[0]!.cognitiveLevel).toBeTruthy();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(out.modelCallId);
    expect(calls[0]!.taskKind).toBe("PAPER_GEN");
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.userId).toBe("dev-teacher-01");

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("paper-gen");
    expect(templates[0]!.version).toBe("v1");
  });

  it("按 sections 的题型与数量产出对应 mock 题", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-teacher-01",
    });

    const out = await router.generatePaper({
      subject: "数学",
      gradeLevel: "G8",
      kpNames: ["一次函数"],
      sections: [
        { type: "SINGLE_CHOICE", count: 3 },
        { type: "FILL_BLANK", count: 2 },
      ],
      difficultyRange: [2, 4],
      textbookVersion: "RENJIAO",
      excludeStems: [],
    });
    expect(out.items.filter((i) => i.type === "SINGLE_CHOICE")).toHaveLength(3);
    expect(out.items.filter((i) => i.type === "FILL_BLANK")).toHaveLength(2);
  });

  it("mock paper items do not repeat after numeric-template normalization", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-teacher-01",
    });

    const out = await router.generatePaper({
      subject: "数学",
      gradeLevel: "G8",
      kpNames: ["一次函数"],
      sections: [{ type: "CALCULATION", count: 3 }],
      difficultyRange: [2, 4],
      excludeStems: [],
    });

    const keys = out.items.map((item) => paperStemTemplateKey(item.stemMd));
    expect(new Set(keys).size).toBe(out.items.length);
  });
});
