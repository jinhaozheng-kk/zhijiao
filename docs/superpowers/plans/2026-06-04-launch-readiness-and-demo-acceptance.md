# Launch Readiness + Demo Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a B-then-A acceptance pass: quasi-production deployment readiness first, then local demo/internal-test readiness.

**Architecture:** Treat this as verification plus narrowly scoped hardening. Use the existing production skeleton, `/readiness`, demo seed, and E2E suite; create an evidence report and update state docs only after fresh command output is captured. Keep external launch blockers separate from repo-controlled defects.

**Tech Stack:** Windows PowerShell, Docker Compose, pnpm 9, Turborepo, Next.js 14, Vitest, Playwright, Prisma/Postgres, Redis.

---

## File Structure

- Create: `docs/ops/launch-readiness-report.md` - final evidence table and go/no-go verdict.
- Modify: `apps/web/tests/server/env.test.ts` - add storage real-mode env coverage if still absent.
- Modify: `docs/claude/implementation-state.md` - append launch-readiness acceptance facts after execution.
- Optional modify: `docs/claude/merge-verification.md` - only if execution discovers a durable recurring probe not already represented by probes 1-81.
- Do not stage unrelated existing changes such as `CLAUDE.md` unless the user explicitly asks to include that separate state cleanup.

## Task 1: Preflight and Dirty Worktree Isolation

**Files:**
- Read only: `CLAUDE.md`, `docs/superpowers/specs/2026-06-04-launch-readiness-and-demo-acceptance-design.md`
- No planned file edits in this task.

- [ ] **Step 1: Check branch and dirty files**

Run:

```powershell
git status --short --branch
git log --oneline -5
```

Expected:

- Branch is `master`.
- There may be an existing unstaged `CLAUDE.md` diff. Treat it as unrelated to this acceptance plan and leave it unstaged.

- [ ] **Step 2: Inspect unrelated diff without changing it**

Run:

```powershell
git diff -- CLAUDE.md
```

Expected:

- If `CLAUDE.md` contains launch-prep state cleanup, record it as "pre-existing uncommitted doc edit" in the final report.
- Do not run `git checkout -- CLAUDE.md`.
- Do not include `CLAUDE.md` in commits for this plan unless a later task explicitly changes that decision with user approval.

- [ ] **Step 3: Re-read accepted spec**

Run:

```powershell
Get-Content -Encoding UTF8 docs\superpowers\specs\2026-06-04-launch-readiness-and-demo-acceptance-design.md
```

Expected:

- Spec says Pass B runs before Pass A.
- Scope separates repo-controlled defects from external blockers.

## Task 2: Storage Env Gate Regression Coverage

**Files:**
- Modify: `apps/web/tests/server/env.test.ts`

- [ ] **Step 1: Confirm whether storage env tests are missing**

Run:

```powershell
Select-String -Path apps\web\tests\server\env.test.ts -Pattern "STORAGE_USE_MOCK|ALIYUN_OSS"
```

Expected before this task:

- If there are no matches, add the tests below.
- If matches already cover both real-mode missing-fields failure and full-fields success, skip to Step 5 and record `Pass`.

- [ ] **Step 2: Add storage keys to `RELEVANT_KEYS`**

Edit `apps/web/tests/server/env.test.ts`. In `RELEVANT_KEYS`, insert these keys after `WECHAT_PAY_USE_MOCK`:

```ts
  "STORAGE_USE_MOCK",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_ENDPOINT",
```

In `VALID_BASE`, insert:

```ts
  STORAGE_USE_MOCK: "true",
```

In the happy-path test, add:

```ts
    expect(mod.env.STORAGE_USE_MOCK).toBe("true");
```

- [ ] **Step 3: Add storage real-mode tests**

Append these tests near the other real/mock adapter env tests:

```ts
  it("STORAGE_USE_MOCK=false + missing ALIYUN_OSS_* throws", async () => {
    applyBase();
    process.env.STORAGE_USE_MOCK = "false";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "id-only";
    await expect(importEnv()).rejects.toThrow(/Real object storage requires ALIYUN_OSS/i);
  });

  it("STORAGE_USE_MOCK=false + complete ALIYUN_OSS_* passes", async () => {
    applyBase();
    process.env.STORAGE_USE_MOCK = "false";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "id";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "secret";
    process.env.ALIYUN_OSS_BUCKET = "zhijiao-private";
    process.env.ALIYUN_OSS_REGION = "oss-cn-beijing";
    process.env.ALIYUN_OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com";
    const mod = await importEnv();
    expect(mod.env.STORAGE_USE_MOCK).toBe("false");
    expect(mod.env.ALIYUN_OSS_BUCKET).toBe("zhijiao-private");
  });
```

- [ ] **Step 4: Run focused env tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts
```

Expected:

- PASS.
- If the failure message does not contain `Real object storage requires ALIYUN_OSS`, inspect `apps/web/server/env.ts` and align the assertion with the actual explicit storage refine message only if the refine is already correct and explicit.

- [ ] **Step 5: Commit storage env coverage if changed**

Run:

```powershell
git status --short
git add apps/web/tests/server/env.test.ts
git commit -m "test(web): cover storage real-mode env gate"
```

Expected:

- Commit is created only if `apps/web/tests/server/env.test.ts` changed.
- If Step 1 found existing coverage and no file changed, do not create an empty commit.

## Task 3: Pass B Static Config and Image Build

**Files:**
- Create outside repo: `D:\tmp\zhijiao-launch-readiness.env`
- No repo file edits in this task.

- [ ] **Step 1: Create dry-run env file outside git**

Run:

```powershell
@'
ZHIJIAO_WEB_IMAGE=zhijiao-web:launch-readiness
ZHIJIAO_MIGRATOR_IMAGE=zhijiao-migrator:launch-readiness
WEB_PORT=3010
POSTGRES_USER=postgres
POSTGRES_PASSWORD=launch-readiness-postgres-password
POSTGRES_DB=zhijiao
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3010
ACCESS_JWT_SECRET=launch-readiness-access-secret-minimum-32-bytes
OTP_PEPPER=launch-readiness-otp-pepper
AI_USE_MOCK=true
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
SMS_USE_MOCK=true
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
WECHAT_OAUTH_USE_MOCK=true
WECHAT_H5_APPID=wx-launch-readiness
WECHAT_H5_SECRET=mock-wechat-secret
WECHAT_PAY_USE_MOCK=true
MOCK_WECHAT_PAY_SECRET=launch-readiness-mock-pay-secret
WECHAT_PAY_APPID=wxpay-launch-readiness
WECHAT_PAY_MCHID=1900000000
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_CERT_SERIAL=
WECHAT_PAY_PUB_KEY_FILE=
WECHAT_PAY_NOTIFY_HOST=
STORAGE_USE_MOCK=true
ALIYUN_OSS_ACCESS_KEY_ID=
ALIYUN_OSS_ACCESS_KEY_SECRET=
ALIYUN_OSS_BUCKET=
ALIYUN_OSS_REGION=
ALIYUN_OSS_ENDPOINT=
CREDIT_PER_YUAN=10
MINOR_MONTHLY_LIMIT_YUAN=200
DEMO_MODE=0
LOG_LEVEL=info
'@ | Set-Content -Encoding UTF8 -LiteralPath 'D:\tmp\zhijiao-launch-readiness.env'
```

Expected:

- `D:\tmp\zhijiao-launch-readiness.env` exists.
- No repo file is created.

- [ ] **Step 2: Validate compose config**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml config
```

Expected:

- Exit code 0.
- Output has `web`, `migrate`, `postgres`, and `redis`.
- `E2E_TEST_HOOKS: "0"` is visible under `web.environment`.

- [ ] **Step 3: Build web and migrator images**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml --profile migrate build web migrate
```

Expected:

- Exit code 0.
- Both `zhijiao-web:launch-readiness` and `zhijiao-migrator:launch-readiness` are built.

- [ ] **Step 4: Record evidence**

Add a note for the final report:

```markdown
| B-config | Pass | `docker compose ... config` exited 0; services web/migrate/postgres/redis present. |
| B-image-build | Pass | `docker compose ... build web migrate` exited 0. |
```

## Task 4: Pass B Production-style Compose Smoke

**Files:**
- No repo file edits in this task.

- [ ] **Step 1: Start database services**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml up -d postgres redis
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml ps
```

Expected:

- `postgres` and `redis` show healthy.

- [ ] **Step 2: Run migrations**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml --profile migrate run --rm migrate
```

Expected:

- Exit code 0.
- Prisma reports migrations applied or already in sync.

- [ ] **Step 3: Start web**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml up -d web
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml ps
```

Expected:

- `web` is running.
- Health status becomes healthy after readiness polling.

- [ ] **Step 4: Check readiness and login**

Run:

```powershell
curl.exe -fsS http://127.0.0.1:3010/readiness
curl.exe -fsS http://127.0.0.1:3010/login
```

Expected:

- `/readiness` exits 0 and returns JSON with database and Redis ok.
- `/login` exits 0 and returns HTML.

- [ ] **Step 5: Verify production guardrails in the dry-run stack**

Run:

```powershell
curl.exe -i http://127.0.0.1:3010/demo
curl.exe -i http://127.0.0.1:3010/api/e2e-hooks/analytics
curl.exe -i http://127.0.0.1:3010/api/e2e-hooks/assignment
curl.exe -i http://127.0.0.1:3010/api/e2e-hooks/error-book
curl.exe -i http://127.0.0.1:3010/api/e2e-hooks/last-otp
```

Expected:

- `/demo` is not available when `DEMO_MODE=0`.
- Each E2E hook returns 404 when `E2E_TEST_HOOKS=0`.

- [ ] **Step 6: Clean up dry-run stack**

Run:

```powershell
docker compose -p zhijiao-launch-readiness --env-file D:\tmp\zhijiao-launch-readiness.env -f docker-compose.prod.yml down -v
```

Expected:

- Exit code 0.
- Temporary containers and volumes for project `zhijiao-launch-readiness` are removed.

## Task 5: Pass B Env and Storage Guard Probes

**Files:**
- No repo file edits in this task unless Task 2 was required.

- [ ] **Step 1: Run env validator suite**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts
```

Expected:

- PASS.
- Evidence includes missing `ACCESS_JWT_SECRET`, real AI/SMS/OAuth/Pay gates, and storage real-mode gate after Task 2.

- [ ] **Step 2: Run storage adapter probe**

Run:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/storage.test.ts
Select-String -Path packages\integrations\src\storage\real.ts -Pattern "NOT_IMPLEMENTED"
```

Expected:

- Storage tests pass.
- `Select-String` shows two `NOT_IMPLEMENTED` matches: one for `put`, one for `getBytes`.

- [ ] **Step 3: Run focused readiness tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/unit/readiness.test.ts tests/unit/readiness-route.test.ts
```

Expected:

- PASS.

## Task 6: Pass A Demo and Product-loop Acceptance

**Files:**
- No repo file edits in this task unless failures expose repo-controlled defects.

- [ ] **Step 1: Reset and verify demo data**

Run:

```powershell
pnpm.cmd demo:reset
pnpm.cmd verify:demo
```

Expected:

- Both commands exit 0.
- Demo reset clears analytics cache and produces deterministic demo data.

- [ ] **Step 2: Run focused demo E2E**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts
```

Expected:

- PASS.
- Student, teacher, and parent demo entries work.
- AI paper and courseware entries remain preview-only.

- [ ] **Step 3: Run focused product-loop E2E**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/image-tutor.spec.ts e2e/assignment-lifecycle.spec.ts e2e/targeted-training.spec.ts e2e/learning-portrait.spec.ts e2e/family-link.spec.ts
```

Expected:

- PASS for all listed specs.
- The listed spec files exist in `apps/web/e2e`.

- [ ] **Step 4: Run full E2E once**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e
```

Expected:

- PASS.
- Do not run this concurrently with build, typecheck, or other E2E commands.

## Task 7: Full Regression Sweep

**Files:**
- No repo file edits in this task unless failures expose repo-controlled defects.

- [ ] **Step 1: Run full typecheck**

Run:

```powershell
pnpm.cmd exec turbo typecheck --force
```

Expected:

- Exit code 0.

- [ ] **Step 2: Run full unit/integration tests**

Run:

```powershell
pnpm.cmd exec turbo test --force
```

Expected:

- Exit code 0.

- [ ] **Step 3: Run high-risk merge probes not covered above**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts tests/integration/error-diagnose-question-access.test.ts tests/integration/assignment-generate-billing.test.ts tests/integration/assignment-permissions.test.ts tests/integration/assignment-state-machine.test.ts tests/integration/assignment-error-book-writeback.test.ts tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts tests/integration/dsar-router.test.ts tests/integration/dsar-cli.test.ts
pnpm.cmd --filter @zhijiao/ai test -- tests/router.test.ts tests/pii-redaction.test.ts
pnpm.cmd --filter @zhijiao/billing test -- tests/pricing.test.ts
pnpm.cmd --filter @zhijiao/domain test -- tests/pii.test.ts
```

Expected:

- Each command exits 0.

## Task 8: Acceptance Report and State Docs

**Files:**
- Create: `docs/ops/launch-readiness-report.md`
- Modify: `docs/claude/implementation-state.md`

- [ ] **Step 1: Create report with observed results**

Create `docs/ops/launch-readiness-report.md` with this structure. Use `Pass`, `Needs fix`, `Blocked by external`, or `Out of scope` from the spec's outcome model for each row based on fresh command output. The example values below are the expected all-pass private dry-run shape; change any row that does not match the evidence.

```markdown
# Launch Readiness Report

**Date:** 2026-06-04

## Verdicts

| Area | Verdict | Reason |
|---|---|---|
| Private production-style dry-run | Pass | Docker config/build/migrate/web/readiness/login completed with mock adapters. |
| Local demo/internal-test | Pass | Demo reset/verify and product-loop E2E completed. |
| Public launch | Blocked by external | ICP/domain/TLS, real SMS, real WeChat OAuth, real WeChat Pay, real OSS/CDN, and production secret/backup operations remain outside this acceptance track. |

## Evidence

| Check | Status | Evidence |
|---|---|---|
| B-config | Pass | `docker compose ... config` exited 0; services web/migrate/postgres/redis present. |
| B-image-build | Pass | `docker compose ... build web migrate` exited 0. |
| B-compose-smoke | Pass | Migration exited 0; web healthy; `/readiness` and `/login` returned success. |
| B-env-gates | Pass | `tests/server/env.test.ts` and `tests/storage.test.ts` passed; OSS real stub throws `NOT_IMPLEMENTED`. |
| B-prod-guards | Pass | `/demo` unavailable with `DEMO_MODE=0`; all E2E hooks returned 404 with `E2E_TEST_HOOKS=0`. |
| A-demo-reset | Pass | `pnpm demo:reset` and `pnpm verify:demo` exited 0. |
| A-product-loops | Pass | Focused demo/product E2E specs passed. |
| A-full-e2e | Pass | Full `pnpm --filter @zhijiao/web test:e2e` passed. |
| Regression | Pass | Full typecheck/test and high-risk probes passed. |

## Repo-controlled Fixes

List each fix commit made during acceptance. If no fixes were required, write: `No repo-controlled fixes were required.`

## External Blockers

- ICP filing, domain, TLS, and reverse proxy.
- Real Aliyun SMS credentials and adapter activation.
- Real WeChat H5 OAuth credentials and official-account callback setup.
- Real WeChat Pay merchant account, APIv3 key, certificate, and notify host.
- Real Aliyun OSS implementation, bucket, and CDN.
- Production secrets injection, backup ownership, and official support/ICP page details.

## Notes

Record any pre-existing uncommitted files that were intentionally excluded from acceptance commits.
```

- [ ] **Step 2: Update implementation state**

Append a concise launch-readiness acceptance note near the top of `docs/claude/implementation-state.md` under `Launch-prep 现状`:

```markdown
- Launch readiness acceptance（2026-06-04）已按 B→A 顺序完成：准生产 Docker compose dry-run（config/build/migrate/web/readiness/login）、env/mock-real 闸门、生产 guard、demo reset/verify、产品闭环 E2E、全量 typecheck/test 均有证据记录在 `docs/ops/launch-readiness-report.md`。私有 dry-run 可继续推进；公网上线仍受 ICP/域名/TLS、真实短信/微信 OAuth/微信支付、真实 OSS/CDN、生产 secrets/备份/支持页信息阻塞。
```

If any repo-controlled check failed and was not fixed, replace "已按 B→A 顺序完成" with "已执行，仍有 repo-controlled follow-up" and list the exact follow-up file/test references in the same bullet.

- [ ] **Step 3: Run docs diff check**

Run:

```powershell
git diff -- docs/ops/launch-readiness-report.md docs/claude/implementation-state.md
git diff --check
```

Expected:

- Diff includes only the report and implementation-state update, plus any intentional earlier test hardening.
- `git diff --check` exits 0.

- [ ] **Step 4: Commit report and state docs**

Run:

```powershell
git add docs/ops/launch-readiness-report.md docs/claude/implementation-state.md
git commit -m "docs(ops): record launch readiness acceptance"
```

Expected:

- Commit is created.

## Task 9: Final Status and Handoff

**Files:**
- No planned file edits in this task.

- [ ] **Step 1: Verify final git status**

Run:

```powershell
git status --short --branch
git log --oneline -8
```

Expected:

- Only pre-existing unrelated files remain unstaged, if any.
- New commits for this plan are visible.

- [ ] **Step 2: Summarize outcome**

Report:

- Private dry-run verdict.
- Local demo/internal-test verdict.
- Public launch verdict.
- Any repo-controlled fixes committed.
- Any external blockers.
- Any pre-existing uncommitted files left alone.
