# Launch Readiness Acceptance Report

Date: 2026-06-04

Scope:

- Pass B: private production-style Docker dry run before Pass A demo validation.
- Pass A: local demo and internal-test acceptance.
- Public launch decision: explicitly separated from local readiness because ICP,
  domain/TLS, real SMS, WeChat OAuth/Pay, OSS/CDN, production secrets, and
  backup policy are external blockers.

## Verdict

- Private production dry run: PASS.
- Local demo/internal-test readiness: PASS.
- Public internet launch: BLOCKED by external production prerequisites.

## Repo Fixes Landed

- `3b79ffd test(web): cover storage real-mode env gate`
  - Added `STORAGE_USE_MOCK=false` coverage for missing and complete
    `ALIYUN_OSS_*` configuration.
- `a9de32c fix(docker): run migrator from db package workdir`
  - Fixed the production migrator container by running
    `pnpm exec prisma migrate deploy` from `/app/packages/db`.
  - This avoided a reproducible segfault from the previous root-level filtered
    pnpm invocation while keeping the official compose migrator path intact.

## Pass B Evidence

- `docker compose -p zhijiao-launch-readiness --env-file .launch-readiness.env -f docker-compose.prod.yml config`
  passed with `web`, `migrate`, `postgres`, and `redis` services.
- `docker compose -p zhijiao-launch-readiness --env-file .launch-readiness.env -f docker-compose.prod.yml --profile migrate build web migrate`
  passed after the migrator fix.
- Temporary Postgres and Redis became healthy.
- `docker compose ... --profile migrate run --rm migrate` applied all 16
  migrations successfully after the migrator fix.
- `docker compose ... up -d web` started the web service and reported healthy.
- `curl.exe -fsS http://127.0.0.1:3010/readiness` returned `ok: true` with DB
  and Redis checks passing.
- `curl.exe -fsS http://127.0.0.1:3010/login` returned HTML 200.
- The temporary compose stack and volumes were cleaned with `down -v`.

Guard checks:

- With `DEMO_MODE=0`, `/demo` returned a disabled demo page with HTTP 200. The
  route is product-disabled, not a 404.
- With `E2E_TEST_HOOKS=0`, `POST /api/e2e-hooks/analytics/assignment/error-book`
  returned 404 `{"error":"disabled"}`.
- `GET /api/e2e-hooks/analytics/assignment/error-book` returned 405 because it
  is POST-only.
- `GET /api/e2e-hooks/last-otp` returned 404 and `POST /api/e2e-hooks/last-otp`
  returned 405.

Operational notes:

- Docker Desktop was initially stopped. The dry run started Docker Desktop and
  continued after the daemon became ready.
- Writing the temporary env file to `D:\tmp` failed with permission denied, so
  the dry run used untracked `.launch-readiness.env` inside the isolated
  worktree instead. The file is not committed and should be removed before
  final handoff.

## Pass A Evidence

Local demo data:

- `pnpm.cmd demo:reset` passed with 13 checks.
- `pnpm.cmd verify:demo` passed with 13 checks.

Focused E2E:

- `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`
  passed 4/4.
- `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/image-tutor.spec.ts e2e/assignment-lifecycle.spec.ts e2e/targeted-training.spec.ts e2e/learning-portrait.spec.ts e2e/family-link.spec.ts`
  passed 6/6.

Full E2E:

- `pnpm.cmd --filter @zhijiao/web test:e2e` passed 24/24.

Non-fatal warnings observed after E2E completion:

- Node `DEP0169` for `url.parse`.
- `ioredis` lookup warnings for `build-phase-placeholder`.

## Regression Evidence

- `pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts`
  passed 31/31.
- `pnpm.cmd --filter @zhijiao/web test -- tests/unit/readiness.test.ts tests/unit/readiness-route.test.ts`
  passed 4/4.
- `pnpm.cmd --filter @zhijiao/integrations test -- tests/storage.test.ts`
  passed 4/4.
- `Select-String packages\integrations\src\storage\real.ts -Pattern "NOT_IMPLEMENTED"`
  confirmed real OSS remains intentionally stubbed at `put` and `getBytes`.
- `pnpm.cmd exec turbo typecheck --force` passed 8/8 packages.
- `pnpm.cmd exec turbo test --force` passed 8/8 packages.
- High-risk merge probes passed:
  - Web integration/unit probe: 11 files, 51 tests.
  - AI probe: 2 files, 9 tests.
  - Billing pricing probe: 1 file, 9 tests.
  - Domain PII probe: 1 file, 10 tests.

## Remaining Blockers

Public launch remains blocked until these are handled outside the local
acceptance scope:

- ICP and domain/TLS.
- Real SMS credentials and smoke.
- Real WeChat OAuth credentials and callback domain.
- Real WeChat Pay merchant credentials, APIv3 key, certificates, notify host,
  and production smoke.
- OSS bucket/CDN and real storage implementation.
- Production secrets injection, backup/restore policy, and operational runbook
  ownership.
