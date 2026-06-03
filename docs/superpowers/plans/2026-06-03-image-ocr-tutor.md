# 图片/OCR 拍照答疑 (Image Tutor) v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student photographs a math problem and gets hint-first 答疑 via one multimodal qwen-vl call that transcribes the stem and tutors at once; the transcript feeds the existing text pipeline.

**Architecture:** A mock-first object-storage adapter (integrations) + an authed upload route store the image; a new `TUTOR_ASK_IMAGE` multimodal AI task (additive `imageDataUrls` on the adapter request) returns `{ stemTranscript, …tutoring }`; `tutor.askImage` charges 2 credits, PII-redacts the transcript, and persists a `USER_ADHOC` Question with `stemImageKeys`. A deterministic mock keeps tests/E2E off real vision.

**Tech Stack:** Next.js 14 App Router, tRPC, Prisma, OpenAI SDK (DashScope compatible mode, qwen-vl-plus), Vitest (node env), Playwright. Spec: `docs/superpowers/specs/2026-06-03-image-ocr-tutor-design.md`.

**Test notes:** Vitest node env. Pure/unit in each package; DB-backed via `apps/web/tests/integration/*` against `zhijiao_test_web` through `appRouter.createCaller(makeCtx(userId))`. Storage + AI both run mock under `NODE_ENV==="test"` / `AI_USE_MOCK`. No new migration (uses existing `Question.stemImageKeys`).

---

## File Structure

- Create `packages/integrations/src/storage/{types,mock,real,build}.ts` + export from `index.ts` (Task 1).
- Modify `apps/web/server/env.ts` — `STORAGE_USE_MOCK` + `ALIYUN_OSS_*` (Task 1).
- Modify `packages/billing/src/pricing.ts` — `TUTOR_ASK_IMAGE: 2` (Task 2).
- Modify `packages/ai/src/{tasks,schemas,adapters/types,adapters/dashscope,adapters/mock,router}.ts` + create `packages/ai/src/prompts/tutoring-image/v1.md` (Task 3).
- Modify `apps/web/server/lib/question.ts` — `stemImageKeys` on upsert (Task 4).
- Create `apps/web/lib/storage.ts` (memoized adapter) + `apps/web/app/api/uploads/tutor-image/route.ts` (Task 5).
- Modify `apps/web/server/routers/tutor.ts` — `askImage` (Task 6).
- Modify `apps/web/components/TutorForm.tsx` (Task 7).
- Create `apps/web/e2e/image-tutor.spec.ts` (Task 8).

---

### Task 1: Object-storage adapter + env

**Files:**
- Create: `packages/integrations/src/storage/{types,mock,real,build}.ts`
- Modify: `packages/integrations/src/index.ts`, `apps/web/server/env.ts`
- Test: `packages/integrations/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/integrations/tests/storage.test.ts
import { describe, it, expect } from "vitest";
import { MockStorageAdapter } from "../src/storage/mock.js";
import { buildStorageAdapter } from "../src/storage/build.js";
import { AliyunOssAdapter } from "../src/storage/real.js";

describe("MockStorageAdapter", () => {
  it("roundtrips bytes by key", async () => {
    const s = new MockStorageAdapter();
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put("adhoc/u1/a.png", bytes, "image/png");
    expect(await s.getBytes("adhoc/u1/a.png")).toEqual(bytes);
    expect(await s.getBytes("missing")).toBeNull();
  });
});

describe("buildStorageAdapter", () => {
  it("returns the mock under test env", () => {
    const s = buildStorageAdapter({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(MockStorageAdapter);
  });
  it("returns the mock when STORAGE_USE_MOCK=true", () => {
    const s = buildStorageAdapter({ STORAGE_USE_MOCK: "true" } as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(MockStorageAdapter);
  });
  it("real adapter throws NOT_IMPLEMENTED until OSS is configured", async () => {
    const real = new AliyunOssAdapter({ accessKeyId: "", accessKeySecret: "", bucket: "", region: "", endpoint: "" });
    await expect(real.getBytes("k")).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/integrations test -- tests/storage.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the adapter files**

```ts
// packages/integrations/src/storage/types.ts
export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}
```

```ts
// packages/integrations/src/storage/mock.ts
import type { StorageAdapter } from "./types.js";
export class MockStorageAdapter implements StorageAdapter {
  private store = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.store.set(key, bytes);
  }
  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.store.get(key) ?? null;
  }
}
// Shared singleton so the upload route and the AI read see the same bytes
// within one process under test / E2E hooks (mirrors sharedTestSmsAdapter).
export const sharedMockStorageAdapter = new MockStorageAdapter();
```

```ts
// packages/integrations/src/storage/real.ts
import type { StorageAdapter } from "./types.js";
export interface OssOpts {
  accessKeyId: string; accessKeySecret: string; bucket: string; region: string; endpoint: string;
}
// Real Aliyun OSS adapter — stub until ICP 备案 + bucket configured (mirrors the
// WeChat-pay real stub). Activated post-launch in its own plan.
export class AliyunOssAdapter implements StorageAdapter {
  constructor(private opts: OssOpts) {}
  async put(): Promise<void> {
    throw new Error("AliyunOssAdapter.put NOT_IMPLEMENTED (activate post-ICP)");
  }
  async getBytes(): Promise<Uint8Array | null> {
    throw new Error("AliyunOssAdapter.getBytes NOT_IMPLEMENTED (activate post-ICP)");
  }
}
```

```ts
// packages/integrations/src/storage/build.ts
import { MockStorageAdapter, sharedMockStorageAdapter } from "./mock.js";
import { AliyunOssAdapter } from "./real.js";
import type { StorageAdapter } from "./types.js";

export function buildStorageAdapter(env: NodeJS.ProcessEnv): StorageAdapter {
  if (env.NODE_ENV === "test" || env.E2E_TEST_HOOKS === "1") return sharedMockStorageAdapter;
  if (env.STORAGE_USE_MOCK === "true") return new MockStorageAdapter();
  return new AliyunOssAdapter({
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID ?? "",
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET ?? "",
    bucket: env.ALIYUN_OSS_BUCKET ?? "",
    region: env.ALIYUN_OSS_REGION ?? "",
    endpoint: env.ALIYUN_OSS_ENDPOINT ?? "",
  });
}
```

Append to `packages/integrations/src/index.ts`:

```ts
export * from "./storage/types.js";
export * from "./storage/mock.js";
export * from "./storage/real.js";
export * from "./storage/build.js";
```

- [ ] **Step 4: Add env fields**

In `apps/web/server/env.ts`, add to the zod schema (follow the existing optional+refine style used by SMS/pay): `STORAGE_USE_MOCK: z.enum(["true", "false"]).default("true")` and optional `ALIYUN_OSS_ACCESS_KEY_ID/ALIYUN_OSS_ACCESS_KEY_SECRET/ALIYUN_OSS_BUCKET/ALIYUN_OSS_REGION/ALIYUN_OSS_ENDPOINT` (`z.string().optional()`), plus a refine: when `STORAGE_USE_MOCK !== "true"` all five real fields must be non-empty (mirror the `WECHAT_PAY_USE_MOCK=false` refine). Add `STORAGE_USE_MOCK ??= "true"` to `apps/web/tests/setup.ts` env defaults.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @zhijiao/integrations test -- tests/storage.test.ts` then `pnpm --filter @zhijiao/integrations typecheck` and `pnpm --filter @zhijiao/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/storage packages/integrations/src/index.ts packages/integrations/tests/storage.test.ts apps/web/server/env.ts apps/web/tests/setup.ts
git commit -m "feat(integrations): object-storage adapter (mock + OSS stub) + env"
```

---

### Task 2: Billing — TUTOR_ASK_IMAGE pricing

**Files:**
- Modify: `packages/billing/src/pricing.ts`
- Test: `packages/billing/tests/pricing.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// packages/billing/tests/pricing.test.ts
import { describe, it, expect } from "vitest";
import { priceOf } from "../src/pricing.js";

describe("pricing", () => {
  it("image tutoring costs 2 credits (vision premium over 1-credit text)", () => {
    expect(priceOf("TUTOR_ASK_IMAGE")).toBe(2);
    expect(priceOf("TUTOR_ASK")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/billing test -- tests/pricing.test.ts`
Expected: FAIL — `TUTOR_ASK_IMAGE` not in `ActionKind` / `PRICING`.

- [ ] **Step 3: Add the action kind + price**

In `packages/billing/src/pricing.ts` add `| "TUTOR_ASK_IMAGE"` to the `ActionKind` union and `TUTOR_ASK_IMAGE: 2,` to `PRICING`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/billing test -- tests/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/billing/src/pricing.ts packages/billing/tests/pricing.test.ts
git commit -m "feat(billing): TUTOR_ASK_IMAGE = 2 credits"
```

---

### Task 3: Multimodal AI task (transcribe + tutor)

**Files:**
- Modify: `packages/ai/src/tasks.ts`, `schemas.ts`, `adapters/types.ts`, `adapters/dashscope.ts`, `adapters/mock.ts`, `router.ts`
- Create: `packages/ai/src/prompts/tutoring-image/v1.md`
- Test: `packages/ai/tests/router.test.ts` (append) — confirm the exact existing router test path first.

- [ ] **Step 1: Write the failing test**

Append to the AI router test suite (match the existing `MockAdapter`/`AiRouter` test setup in `packages/ai/tests/router.test.ts`):

```ts
import { describe, it, expect } from "vitest";
// reuse the file's existing makeRouter()/prisma harness; if it builds an AiRouter
// with MockAdapter, call tutorImage through it.

describe("tutorImage (multimodal)", () => {
  it("returns a stem transcript plus tutoring output and forwards the image", async () => {
    let seenImages: string[] | undefined;
    const adapter = {
      name: "spy",
      async call(req: { imageDataUrls?: string[] }) {
        seenImages = req.imageDataUrls;
        return {
          content: JSON.stringify({
            stemTranscript: "已知一次函数 y = 2x - 3，求与 x 轴交点的横坐标。",
            restatement: "求一次函数与 x 轴交点。",
            knowledgePoints: ["一次函数与一元一次方程关系"],
            steps: ["令 y = 0", "解 2x - 3 = 0"],
            pitfalls: ["别忘了 y=0"],
            finalAnswer: "x = 1.5",
          }),
          model: "qwen-vl-plus",
        };
      },
    };
    const router = makeRouterWithAdapter(adapter); // build AiRouter with the spy adapter + test prisma
    const out = await router.tutorImage({ imageDataUrl: "data:image/png;base64,AAAA", studentGrade: "G8" });
    expect(out.stemTranscript).toContain("一次函数");
    expect(out.finalAnswer).toBe("x = 1.5");
    expect(seenImages).toEqual(["data:image/png;base64,AAAA"]);
  });
});
```

(If the existing suite already exposes a router factory, reuse it; otherwise construct `new AiRouter({ prisma, adapter, userId: null })` exactly as the neighboring tutor test does.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/ai test -- tests/router.test.ts`
Expected: FAIL — `router.tutorImage` is not a function / `TutoringImageOutputSchema` missing.

- [ ] **Step 3: Schemas**

In `packages/ai/src/schemas.ts`, after `TutoringOutputSchema`:

```ts
export const TutoringImageInputSchema = z.object({
  imageDataUrl: z.string().min(1),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).optional(),
});
export type TutoringImageInput = z.infer<typeof TutoringImageInputSchema>;

export const TutoringImageOutputSchema = TutoringOutputSchema.extend({
  stemTranscript: z.string().min(1, "题面转写不能为空").max(4000),
});
export type TutoringImageOutput = z.infer<typeof TutoringImageOutputSchema>;
```

- [ ] **Step 4: Task kind + model**

In `packages/ai/src/tasks.ts` add `| "TUTOR_ASK_IMAGE"` to `TaskKind` and `TUTOR_ASK_IMAGE: "qwen-vl-plus",` to `TASK_MODEL_MAP`.

- [ ] **Step 5: Adapter image support**

In `packages/ai/src/adapters/types.ts` add to `AdapterRequest`:

```ts
  imageDataUrls?: string[]; // multimodal (qwen-vl): data URLs appended to the last user message
```

In `packages/ai/src/adapters/dashscope.ts`, build a multimodal message when present (OpenAI-compatible content parts):

```ts
  async call(req: AdapterRequest): Promise<AdapterResponse> {
    const messages = req.imageDataUrls?.length
      ? req.messages.map((m, i, arr) =>
          m.role === "user" && i === arr.length - 1
            ? {
                role: m.role,
                content: [
                  { type: "text" as const, text: m.content },
                  ...req.imageDataUrls!.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                ],
              }
            : m,
        )
      : req.messages;
    const resp = await this.client.chat.completions.create({
      model: req.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: req.temperature ?? 0.3,
      response_format:
        req.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    });
    const choice = resp.choices[0];
    if (!choice?.message?.content) throw new Error("DashScope returned no content");
    return { content: choice.message.content, tokensIn: resp.usage?.prompt_tokens, tokensOut: resp.usage?.completion_tokens, model: resp.model };
  }
```

(Real-mode only — exercised when `AI_USE_MOCK=false`; tests use the mock.)

- [ ] **Step 6: Mock default + dispatch**

In `packages/ai/src/adapters/mock.ts` add a default and dispatch keyword:

```ts
const DEFAULT_TUTORING_IMAGE = {
  stemTranscript: "已知一次函数 y = 2x - 3，求它与 x 轴交点的横坐标。",
  ...DEFAULT_TUTORING,
};
```

In `pickDefault`, before the final `return DEFAULT_TUTORING;`:

```ts
  if (sys.includes("拍照辅导助手")) return DEFAULT_TUTORING_IMAGE;
```

- [ ] **Step 7: Router method + forbidden scan**

In `packages/ai/src/router.ts`: add a scan helper and the method. First add `TutoringImageInputSchema, TutoringImageOutputSchema, type TutoringImageOutput` to the schema imports. Add the scan:

```ts
function scanTutoringImageOutputForForbidden(out: TutoringImageOutput): string[] {
  const corpus = [
    out.stemTranscript, out.restatement, out.finalAnswer,
    ...out.knowledgePoints, ...out.steps, ...out.pitfalls,
  ].join("\n");
  return findForbidden(corpus);
}
```

Extend `runJsonTaskWithAudit`'s `request` param type to include `imageDataUrls?: string[]` (it already forwards `args.request` to `adapter.call`). Then add:

```ts
  async tutorImage(input: unknown): Promise<TutoringImageOutput & { modelCallId: string }> {
    const parsed = TutoringImageInputSchema.parse(input);
    const taskKind: TaskKind = "TUTOR_ASK_IMAGE";
    const prompt = await loadPrompt("tutoring-image", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);
    const userContent = prompt.interpolate({ studentGrade: parsed.studentGrade ?? "G8" });
    const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
    const request = {
      model,
      messages: [
        { role: "system" as const, content: "你是严谨、面向中国 K12 的数学拍照辅导助手。" },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.3,
      imageDataUrls: [parsed.imageDataUrl],
    };
    return this.runJsonTaskWithAudit({
      taskKind, promptTemplateId, request,
      schema: TutoringImageOutputSchema,
      scanForbidden: scanTutoringImageOutputForForbidden,
    });
  }
```

- [ ] **Step 8: Prompt file**

Create `packages/ai/src/prompts/tutoring-image/v1.md` (match the front-matter/interpolation format of `prompts/tutoring/v1.md`). It must instruct: faithfully transcribe the problem in the image into `stemTranscript` (Markdown + LaTeX for formulas, no solving in the transcript); then produce the hint-first output (`restatement / knowledgePoints / steps / pitfalls / finalAnswer`); method-transfer framing for `{studentGrade}`; **no answer-copying / no 提分/分数/通过/恐吓**; output JSON only. Confirm the loader path/extension by reading `registry.ts loadPrompt` + an existing prompt before writing.

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm --filter @zhijiao/ai test -- tests/router.test.ts` then `pnpm --filter @zhijiao/ai typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/ai/src apps -- ":!apps"  # stage packages/ai only
git add packages/ai/src packages/ai/tests
git commit -m "feat(ai): TUTOR_ASK_IMAGE multimodal task (transcribe + tutor)"
```

---

### Task 4: Persist stemImageKeys on USER_ADHOC question

**Files:**
- Modify: `apps/web/server/lib/question.ts`
- Test: `apps/web/tests/integration/question-image-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/integration/question-image-keys.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { upsertUserAdhocQuestion } from "@/server/lib/question";

beforeEach(async () => { await resetDb(); await prisma.subject.upsert({ where: { code: "math" }, update: {}, create: { code: "math", name: "数学" } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe("upsertUserAdhocQuestion stemImageKeys", () => {
  it("persists the image key on a new adhoc question", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const q = await upsertUserAdhocQuestion(prisma, {
      userId, stemMd: "解方程 2x+1=0", stemImageKeys: [`adhoc/${userId}/a.png`],
    });
    expect(q.stemImageKeys).toEqual([`adhoc/${userId}/a.png`]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/question-image-keys.test.ts`
Expected: FAIL — `stemImageKeys` not accepted / not persisted.

- [ ] **Step 3: Extend the helper**

In `apps/web/server/lib/question.ts`: add `stemImageKeys?: string[]` to `UpsertUserAdhocQuestionArgs`, and in the `create({ data: {...} })` set `stemImageKeys: args.stemImageKeys ?? []`. (Leave the existing-dedup early-return as-is; a re-upserted identical stem keeps its first image — acceptable for v1.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/question-image-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/question.ts apps/web/tests/integration/question-image-keys.test.ts
git commit -m "feat(web): upsertUserAdhocQuestion accepts stemImageKeys"
```

---

### Task 5: Image upload route

**Files:**
- Create: `apps/web/lib/storage.ts`, `apps/web/app/api/uploads/tutor-image/route.ts`
- Test: `apps/web/tests/integration/tutor-image-upload.test.ts`

- [ ] **Step 1: Add the storage singleton**

```ts
// apps/web/lib/storage.ts
import "server-only";
import { buildStorageAdapter, type StorageAdapter } from "@zhijiao/integrations";

let cached: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (!cached) cached = buildStorageAdapter(process.env);
  return cached;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/tests/integration/tutor-image-upload.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const cookieStore: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (n: string) => (cookieStore.value ? { name: n, value: cookieStore.value } : undefined) }),
}));

import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { signAccess, COOKIE_AT } from "@zhijiao/auth";
import { env } from "@/server/env";
import { POST } from "@/app/api/uploads/tutor-image/route";

async function token(userId: string) {
  return signAccess({ userId, sessionId: randomUUID(), persona: "STUDENT", roles: [] }, env.ACCESS_JWT_SECRET);
}
function form(bytes: Uint8Array, type: string, name = "x.png") {
  const fd = new FormData();
  fd.set("file", new File([bytes], name, { type }));
  return fd;
}

beforeEach(async () => { await resetDb(); cookieStore.value = undefined; });
afterAll(async () => { await prisma.$disconnect(); });

describe("POST /api/uploads/tutor-image", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST(new Request("http://localhost/api/uploads/tutor-image", { method: "POST", body: form(new Uint8Array([1]), "image/png") }));
    expect(res.status).toBe(401);
  });
  it("400 on non-image type", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
    cookieStore.value = await token(id);
    const res = await POST(new Request("http://localhost/api/uploads/tutor-image", { method: "POST", body: form(new Uint8Array([1]), "text/plain", "x.txt") }));
    expect(res.status).toBe(400);
  });
  it("stores and returns an owner-scoped key", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
    cookieStore.value = await token(id);
    const res = await POST(new Request("http://localhost/api/uploads/tutor-image", { method: "POST", body: form(new Uint8Array([1, 2, 3]), "image/png") }));
    expect(res.status).toBe(200);
    const { imageKey } = (await res.json()) as { imageKey: string };
    expect(imageKey.startsWith(`adhoc/${id}/`)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/tutor-image-upload.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 4: Implement the route**

```ts
// apps/web/app/api/uploads/tutor-image/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getShellIdentity } from "@/server/shell-identity";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function POST(req: Request) {
  const identity = await getShellIdentity();
  if (!identity) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: "UNSUPPORTED_TYPE" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "TOO_LARGE" }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageKey = `adhoc/${identity.userId}/${randomUUID()}.${ext}`;
  await getStorage().put(imageKey, bytes, file.type);
  return NextResponse.json({ imageKey });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/tutor-image-upload.test.ts`
Expected: PASS (3 tests). (The mocked `next/headers` + the shared mock storage under `NODE_ENV=test` make this deterministic.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/storage.ts "apps/web/app/api/uploads/tutor-image/route.ts" apps/web/tests/integration/tutor-image-upload.test.ts
git commit -m "feat(web): authed tutor-image upload route (owner-scoped key)"
```

---

### Task 6: tutor.askImage procedure

**Files:**
- Modify: `apps/web/server/routers/tutor.ts`
- Test: `apps/web/tests/integration/tutor-ask-image.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/integration/tutor-ask-image.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";
import { sharedMockStorageAdapter } from "@zhijiao/integrations";
import { appRouter } from "@/server/routers/_root";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
function makeCtx(userId: string) {
  return { db: prisma, redis, auth: { userId, sessionId: "s", persona: "STUDENT" as const, roles: [] as Role[], isMinor: false, guardianConsentStatus: "NOT_REQUIRED" as const }, authError: null, ip: "127.0.0.1", ua: "vitest", requestId: "req-img", resHeaders: new Headers(), cookies: {} };
}
async function seedFundedUser() {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
  await prisma.subject.upsert({ where: { code: "math" }, update: {}, create: { code: "math", name: "数学" } });
  const wallet = await prisma.wallet.create({ data: { userId: id, balance: 100 } });
  await prisma.creditLedger.create({ data: { walletId: wallet.id, kind: "ADJUST_ADD", delta: 100, balanceAfter: 100, idemKey: `seed:${id}`, actionKind: "SEED", createdByUserId: id } });
  return id;
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); redis.disconnect(); });

describe("tutor.askImage", () => {
  it("rejects a non-owner image key", async () => {
    const id = await seedFundedUser();
    const caller = appRouter.createCaller(makeCtx(id));
    await expect(caller.tutor.askImage({ imageKey: `adhoc/${randomUUID()}/x.png`, clientRequestId: randomUUID() }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("transcribes, charges 2 credits, and persists a USER_ADHOC question with the image key", async () => {
    const id = await seedFundedUser();
    const key = `adhoc/${id}/${randomUUID()}.png`;
    await sharedMockStorageAdapter.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const caller = appRouter.createCaller(makeCtx(id));
    const out = await caller.tutor.askImage({ imageKey: key, studentGrade: "G8", clientRequestId: randomUUID() });
    expect(out.stemTranscript.length).toBeGreaterThan(0);
    expect(out.questionId).toBeTruthy();

    const q = await prisma.question.findUniqueOrThrow({ where: { id: out.questionId } });
    expect(q.stemImageKeys).toContain(key);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: id } });
    expect(wallet.balance).toBe(98); // 100 - 2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/tutor-ask-image.test.ts`
Expected: FAIL — `tutor.askImage` undefined.

- [ ] **Step 3: Implement the procedure**

In `apps/web/server/routers/tutor.ts`: add imports `import { getStorage } from "@/lib/storage";` and reuse existing `chargeMiddleware`, `redactPii`, `upsertUserAdhocQuestion`, `reconcileHintsSync`, `getAiRouter`, `TRPCError`, `ComplianceRejectedError`, `logger`. Add to the router object:

```ts
  askImage: authedProcedure
    .use(chargeMiddleware("TUTOR_ASK_IMAGE"))
    .input(z.object({
      imageKey: z.string().min(1),
      studentGrade: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]).optional(),
      clientRequestId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const prefix = `adhoc/${ctx.auth.userId}/`;
      if (!input.imageKey.startsWith(prefix)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在", cause: { reason: "IMAGE_NOT_FOUND" } });
      }
      const bytes = await getStorage().getBytes(input.imageKey);
      if (!bytes) throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在", cause: { reason: "IMAGE_NOT_FOUND" } });
      const contentType = input.imageKey.endsWith(".png") ? "image/png" : input.imageKey.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const imageDataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;

      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).tutorImage({ imageDataUrl, studentGrade: input.studentGrade });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "讲解内容未通过合规检查，请换一张图或稍后再试。", cause: { reason: "COMPLIANCE_REJECTED", original: e } });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "识别失败，请稍后再试。", cause: { reason: "TUTOR_IMAGE_INTERNAL" } });
      }

      const { redacted: redactedStem, hits } = redactPii(ai.stemTranscript);
      if (hits.phone > 0 || hits.idCard > 0) {
        logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK_IMAGE", hits });
      }
      const question = await upsertUserAdhocQuestion(ctx.db, {
        userId: ctx.auth.userId, stemMd: redactedStem, stemImageKeys: [input.imageKey],
      });
      try {
        await reconcileHintsSync(ctx.db, { questionId: question.id, hints: ai.knowledgePoints, source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: question.id });
      } catch (e) {
        logger.warn({ event: "kp_reconcile_sync_failed", source: "TUTOR_IMAGE", questionId: question.id, err: String(e) });
      }
      const { stemTranscript: _t, modelCallId: _m, ...tutoring } = ai;
      return { ...tutoring, stemTranscript: redactedStem, questionId: question.id };
    }),
```

(Confirm `getAiRouter(...).tutorImage` is exposed; the router method from Task 3 is public on `AiRouter`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/tutor-ask-image.test.ts`
Expected: PASS (2 tests). If `creditLedger` seed columns differ, mirror the exact seed in `packages/db/prisma/seed/1_test_users.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/routers/tutor.ts apps/web/tests/integration/tutor-ask-image.test.ts
git commit -m "feat(web): tutor.askImage (multimodal, 2 credits, owner-scoped)"
```

---

### Task 7: TutorForm image upload UI

**Files:**
- Modify: `apps/web/components/TutorForm.tsx`

- [ ] **Step 1: Add the image flow**

Add to `TutorForm`: a file input `<input type="file" accept="image/*" capture="environment" data-testid="tutor-image-input">`; on change, upload via `fetch("/api/uploads/tutor-image", { method: "POST", body: formData })` → `{ imageKey }`, then call a new `trpc.tutor.askImage.useMutation()` with `{ imageKey, studentGrade: grade, clientRequestId: crypto.randomUUID() }`. While pending render `<AiGeneratingPanel label="识别题目并讲解中…" />`. On success, set `data` to the returned object (it has the same tutoring shape so the existing output block renders) and show the transcript in an editable textarea (`data-testid="tutor-transcript"`, value seeded from `stemTranscript`). Add a button "纠正题面，按文本重答" (`data-testid="tutor-image-correct"`) that copies the edited transcript into `questionStem` and calls the existing `submit()` (text `tutor.ask`, 1 credit). Mount `ErrorAnalysisCard key={data.questionId} questionId={data.questionId}` exactly as the text path. Errors route through `copyForReason` with the existing `INSUFFICIENT_BALANCE` → `去充值` deep-link.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @zhijiao/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/TutorForm.tsx
git commit -m "feat(web): TutorForm photo upload + transcript edit + re-ask"
```

---

### Task 8: E2E + full regression

**Files:**
- Create: `apps/web/e2e/image-tutor.spec.ts`

- [ ] **Step 1: Write the E2E**

```ts
// apps/web/e2e/image-tutor.spec.ts
import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

const PHONE = "13800000004";
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("image tutor: upload a photo and get an explanation + transcript", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  const input = page.getByTestId("tutor-image-input");
  await input.setInputFiles({ name: "q.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64") });

  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("tutor-transcript")).toBeVisible();
});
```

(Match the login helper import the other specs use; with mock storage + mock AI this is deterministic. If the funded test user differs, use a seeded phone with credits.)

- [ ] **Step 2: Run the image-tutor E2E**

Run: `pnpm --filter @zhijiao/web test:e2e image-tutor.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full web E2E**

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: all specs PASS (new upload route + TutorForm changes must not break the existing tutor flow).

- [ ] **Step 4: Full typecheck + unit/integration**

Run: `pnpm typecheck` then `pnpm test`
Expected: 8/8 packages PASS (ai gains tutorImage; integrations gains storage; billing pricing; web gains 3 integration suites).

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/image-tutor.spec.ts
git commit -m "test(e2e): image tutor upload + explanation"
```

---

## Implementation Order

1. Task 1 — storage adapter + env (foundation).
2. Task 2 — pricing (tiny, independent).
3. Task 3 — multimodal AI task (the core capability).
4. Task 4 — question stemImageKeys.
5. Task 5 — upload route (depends on 1).
6. Task 6 — askImage procedure (depends on 1,2,3,4).
7. Task 7 — UI (depends on 5,6).
8. Task 8 — E2E + regression lock.

## Self-Review

- **Spec coverage:** §3 storage → Task 1; §4 upload route → Task 5; §5 multimodal task → Task 3; §6 procedure (ownership, 2cr, post-hoc PII redact, persist stemImageKeys, KP reconcile) → Tasks 2,4,6; §7 UI → Task 7; §8 env → Task 1; §9 compliance (owner-only key, transcript redaction, hint-first prompt) → Tasks 1,3,5,6; §10 testing → Tasks 1,3,4,5,6,8; §11 acceptance → Task 8. No gaps.
- **Placeholder scan:** code steps contain real code; judgment steps (Task 3 Step 8 prompt format, Task 6 Step 4 seed-shape) name the exact reference files to match.
- **Type consistency:** `StorageAdapter.put/getBytes` (Task 1) used by `getStorage` (Task 5) + askImage (Task 6); `TutoringImageInput{imageDataUrl}` / `TutoringImageOutput{stemTranscript}` (Task 3) consumed by askImage; `imageDataUrls?: string[]` on `AdapterRequest` (Task 3) forwarded by `runJsonTaskWithAudit` and built by dashscope; `TUTOR_ASK_IMAGE` is consistent across pricing (Task 2), tasks/TASK_MODEL_MAP (Task 3), chargeMiddleware (Task 6); `stemImageKeys` on `UpsertUserAdhocQuestionArgs` (Task 4) set by askImage (Task 6); upload returns `{ imageKey }` consumed by TutorForm (Task 7).
- **Note for executor:** confirm the AI router test harness factory, the `creditLedger` seed column shape (`actionKind` value), the prompt loader extension, and the E2E login helper / funded phone against neighbors before running — they are referenced, not redefined here.
