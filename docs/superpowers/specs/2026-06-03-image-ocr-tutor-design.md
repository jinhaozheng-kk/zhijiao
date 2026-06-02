# 图片/OCR 拍照答疑 (Image Tutor) v1 Design

## 1. Goal

Let a student photograph or screenshot a math problem and get the same structured
hint-first 答疑 they get from typing — closing the last MVP loop item before launch-prep.

The chosen path is **hybrid via a single multimodal call**: one qwen-vl call both
transcribes the problem stem and produces the tutoring output. The transcript feeds the
existing text pipeline (PII redaction, persistence, dedup, compliance, KP reconcile); the
image informs the explanation. No separate OCR integration.

Not blocked on ICP: object storage runs on a mock adapter for MVP (real Aliyun OSS is a
stub, activated post-备案), mirroring the SMS / WeChat-pay adapter pattern.

## 2. Scope / non-goals

In scope: object-storage adapter (mock + real stub); an authed image-upload route; a
multimodal `TUTOR_ASK_IMAGE` AI task (transcribe + tutor in one call) with a deterministic
mock; a `tutor.askImage` procedure charging 2 credits; persisting the image-derived
`USER_ADHOC` Question (`stemMd` = transcript, `stemImageKeys` = [key]); a `TutorForm` upload
affordance with an editable transcript and a "correct & re-ask as text" fallback.

Out of scope: real OSS activation (post-ICP); presigned client-direct upload (MVP proxies
through the server); pixel-level PII redaction of the image; image input for
error.diagnose / variant / assignment flows (tutor only); multi-image per question (single
image v1).

## 3. Object storage adapter

New `packages/integrations/src/storage/{types,mock,real,build}.ts`, mirroring `sms/`:

```
interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}
buildStorageAdapter(env): StorageAdapter
```

`buildStorageAdapter`: `NODE_ENV==="test" || E2E_TEST_HOOKS==="1"` → a shared in-process
singleton mock (so the upload route and the AI read see the same bytes within one process,
like `sharedTestSmsAdapter`); `STORAGE_USE_MOCK==="true"` → `MockStorageAdapter` (in-memory
Map); else `AliyunOssAdapter` (real stub: constructor stores creds, methods throw
`NOT_IMPLEMENTED` until 备案 + bucket configured — same shape as the WeChat-pay real stub).

Key convention: `adhoc/<userId>/<uuid>.<ext>` — the `<userId>` prefix is the ownership
boundary (the procedure checks the key starts with `adhoc/<callerId>/`).

## 4. Upload route

`apps/web/app/api/uploads/tutor-image/route.ts` — `POST`, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`:

- Resolve the caller from the session (reuse `getShellIdentity`-style cookie → `verifyAccess`;
  or the existing context auth). Reject unauthenticated → 401.
- Accept `multipart/form-data` with one `file`. Validate content-type ∈
  {image/jpeg, image/png, image/webp} and size ≤ 5 MB → 400 on violation.
- Mint key `adhoc/<userId>/<uuid>.<ext>`, `await storage.put(...)`, return `{ imageKey }`.
- Server-proxied (no presign) for MVP; real OSS can presign later without changing callers.

## 5. Multimodal AI task

In `packages/ai`:

- `tasks.ts`: add `TUTOR_ASK_IMAGE` to `TaskKind` and `TASK_MODEL_MAP` → `"qwen-vl-plus"`.
- `adapters/types.ts`: add optional `imageDataUrls?: string[]` to `AdapterRequest` (additive;
  string-content messages unchanged). The DashScope adapter, when `imageDataUrls` is present,
  builds qwen-vl's multimodal user message (text + image_url parts); the mock ignores it.
- `schemas.ts`: `TutoringImageInputSchema = { imageDataUrl: string (data URL), studentGrade? }`
  and `TutoringImageOutputSchema = TutoringOutputSchema.extend({ stemTranscript: z.string().min(1) })`.
- `router.ts`: new `tutorImage(input)` method — mirrors `tutor()` but passes `imageDataUrls`
  on the request, parses `TutoringImageOutputSchema`, and scans forbidden over the tutoring
  fields **plus** `stemTranscript`. Reuses the same retry/audit/`redactPii(response.content)`
  loop (extend `runJsonTaskWithAudit` to forward optional `imageDataUrls`, or replicate the
  loop). Prompt `tutoring-image/v1.md` instructs: transcribe the stem faithfully into
  `stemTranscript` (Markdown + LaTeX for formulas) and produce the standard hint-first output;
  no answer-copying framing.
- `adapters/mock.ts`: for `qwen-vl-plus` / the image task, return a deterministic JSON with a
  Chinese `stemTranscript` (e.g. 一次函数题) + valid tutoring fields, so unit/integration/E2E
  run without a real vision model (gated by `AI_USE_MOCK`, already the default in tests).

## 6. tutor.askImage procedure

Add to `tutorRouter` (`apps/web/server/routers/tutor.ts`):

```
askImage: authedProcedure
  .use(chargeMiddleware("TUTOR_ASK_IMAGE"))   // 2 credits
  .input({ imageKey: string, studentGrade?: GradeEnum, clientRequestId: uuid })
  .mutation(...)
```

Flow:
1. **Ownership**: reject unless `imageKey` starts with `adhoc/<ctx.auth.userId>/` → `NOT_FOUND`
   (existence side-channel safe).
2. `bytes = await storage.getBytes(imageKey)`; missing → `NOT_FOUND`. Build a data URL.
3. `ai = await getAiRouter(userId).tutorImage({ imageDataUrl, studentGrade })`.
   - On `ComplianceRejectedError` → `BAD_REQUEST { reason: "COMPLIANCE_REJECTED" }` (charge not
     compensated, existing whitelist). Other failures → `INTERNAL_SERVER_ERROR`.
4. **Compliance / PII are post-hoc** (no pre-call text exists in a single multimodal call):
   `redactPii(ai.stemTranscript)` → `redactedStem`; the AI router already scans output for
   forbidden phrases and redacts `response.content` before parse, so banned content is rejected
   inside the call. Persist only `redactedStem`.
5. `upsertUserAdhocQuestion(ctx.db, { userId, stemMd: redactedStem, stemImageKeys: [imageKey] })`
   — extend the helper to accept and set `stemImageKeys`. Dedup by `normalizedStemHash` of the
   transcript (image-derived and text questions with the same stem dedup together — acceptable).
6. `reconcileHintsSync(... hints: ai.knowledgePoints ...)` — identical to the text path; never
   breaks the main flow.
7. Return `{ ...tutoringFields, stemTranscript: redactedStem, questionId }`.

`TUTOR_ASK_IMAGE` is added to the billing action-kind / credit-cost map at **2 credits** (vision
is costlier than the 1-credit text `TUTOR_ASK`); it flows through the existing
chargeMiddleware / compensation / minor-monthly-cap machinery unchanged.

## 7. UI

`apps/web/components/TutorForm.tsx` gains an image entry:

- A file/camera input (`accept="image/*" capture="environment"`). On select: `POST` the file to
  `/api/uploads/tutor-image` → `{ imageKey }`; show a thumbnail + "识别中…" (the `AiGeneratingPanel`).
- Call `tutor.askImage({ imageKey, studentGrade, clientRequestId })`. On success render the
  standard explanation block + the **transcribed stem** in an editable textarea labelled
  "识别到的题目（可修改）".
- If the transcript is wrong: a "纠正题面，按文本重答" button copies the edited transcript into the
  text flow and calls the existing `tutor.ask` (1 credit). Mount `ErrorAnalysisCard` with the
  returned `questionId` exactly as the text path does.
- Errors route through `lib/error-copy.ts`; `INSUFFICIENT_BALANCE` keeps the `去充值` deep-link.
  Insufficient balance / consent gates behave as the existing text path.

## 8. env

Add to `apps/web/server/env.ts` (zod validator, same refine pattern as SMS/pay):
`STORAGE_USE_MOCK` (enum `"0"|"1"`-style or `"true"`/default mock in dev) and the real
`ALIYUN_OSS_*` (accessKeyId / secret / bucket / region / endpoint), required only when storage
is real. The integrations `buildStorageAdapter` reads these. Tests set mock via the
`NODE_ENV==="test"` branch.

## 9. Compliance & safety

- Hint-first preserved (prompt forbids answer-first); no 提分/分数/通过/恐吓 copy.
- Image stored **owner-only** (key prefix gate; never served cross-user). MVP does **not**
  pixel-redact PII in the image — documented residual risk, mitigated by owner-only access; the
  transcript IS PII-redacted before persistence.
- Minor protection / consent posture matches the existing `tutor.ask` (authed + charge).
- PII export / deletion: `Question.stemImageKeys` already belongs to the user's questions;
  注销去标识化已覆盖 USER_ADHOC question 链路 — confirm the image keys are dropped with the
  question on scrub (no new PII table; keys are opaque storage refs, not PII themselves).

## 10. Testing

- **integrations:** `MockStorageAdapter` put/getBytes roundtrip; `buildStorageAdapter` selects
  test/mock/real by env; real stub throws `NOT_IMPLEMENTED`.
- **ai:** mock `tutorImage` returns `stemTranscript` + valid tutoring output and passes schema;
  forbidden-scan covers `stemTranscript`; `imageDataUrls` is forwarded to `adapter.call`.
- **web integration:** `tutor.askImage` — rejects a non-owner `imageKey` (`NOT_FOUND`); charges
  2 credits (ledger DEBIT `TUTOR_ASK_IMAGE`); persists a `USER_ADHOC` Question with `stemImageKeys`
  set and a PII-redacted `stemMd`; compliance-reject path does not compensate. Upload route:
  401 unauthenticated, 400 on bad type/size, returns owner-scoped key on success.
- **E2E:** with mock storage + mock AI (deterministic), upload a small fixture image via the
  upload route, run askImage from the browser, assert the explanation + transcript render. Then
  full `@zhijiao/web` E2E + `pnpm typecheck` + `pnpm test` stay green.

## 11. Acceptance criteria

- A student can upload a photo and receive a hint-first explanation plus an editable transcript;
  the question persists as `USER_ADHOC` with the image key and a redacted stem.
- `TUTOR_ASK_IMAGE` charges 2 credits through the existing billing path; compliance rejection is
  not refunded.
- Object storage runs on the mock adapter with no real OSS credentials; the real adapter is a
  stub that does not break the build.
- Non-owner image keys are inaccessible; the transcript is PII-redacted before persistence.
- The "correct & re-ask as text" fallback reuses the existing `tutor.ask` flow.
- Full web E2E + typecheck + all unit/integration suites pass.

## 12. Out of scope (follow-ups)

- Real Aliyun OSS activation + presigned client-direct upload (post-ICP, with WeChat pay / SMS).
- Image PII pixel redaction; multi-image; image input for diagnose/variant.
- Launch-prep (deploy / object-storage prod config / CDN) — separate track after MVP closes.
