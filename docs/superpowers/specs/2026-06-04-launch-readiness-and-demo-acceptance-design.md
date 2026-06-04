# Launch Readiness + Demo Acceptance Design

**Date:** 2026-06-04

## Goal

Run a focused acceptance pass after the MVP loop is closed. The order is:

1. **B: quasi-production deployment acceptance** - prove the deployable skeleton is coherent, fail-close where it should, and can run a private production-style smoke without public launch dependencies.
2. **A: local demo/internal-test acceptance** - prove the product can be reset, entered, and demonstrated through the main student, teacher, and parent loops.

The output is a go/no-go table, a list of real fixes if any are found, and updated operational/project state docs. This is an acceptance and hardening track, not a new product-feature plan.

## Background

The repo is already in launch-prep:

- GitHub Actions CI runs typecheck, tests, E2E, and Docker image build.
- `Dockerfile`, `docker-compose.prod.yml`, `.env.production.example`, and `docs/ops/production-deploy.md` define a production-style skeleton.
- `/readiness` checks database and Redis dependencies.
- `docs/claude/merge-verification.md` contains 81 regression probes.
- `/demo`, deterministic demo seed, role-aware shell, targeted training, and image/OCR tutor are landed.

The remaining launch blockers are mostly external: ICP/domain/TLS, real SMS, real WeChat OAuth, real WeChat Pay, real OSS/CDN, and production secrets/backup operations. This track should separate those external blockers from code or configuration defects that can be fixed now.

## Scope

### In Scope

- Verify Docker compose production skeleton shape.
- Verify web and migrator image build paths.
- Verify production-style migration and startup sequence.
- Verify `/readiness`, `/login`, and minimal authenticated smoke in a private dry-run stack.
- Verify env fail-close behavior for required base env and real/mock adapter gates.
- Verify demo/test hooks are disabled outside allowed demo/test contexts.
- Verify demo reset, demo data checks, role entries, and main product loops.
- Verify the subset of merge probes that carry launch/demo risk, plus full typecheck/test/E2E where practical.
- Record outcomes as `Pass`, `Needs fix`, `Blocked by external`, or `Out of scope`.

### Out of Scope

- Real Aliyun SMS activation.
- Real WeChat OAuth activation.
- Real WeChat Pay V3 activation.
- Real Aliyun OSS implementation or CDN setup.
- Domain, ICP, TLS, reverse proxy, and public traffic routing.
- New product flows such as production AI paper generation or AI courseware.
- Major UI redesign. Only fix issues that block acceptance or create misleading demo behavior.

## Acceptance Architecture

The work is split into two acceptance passes.

### Pass B: Quasi-production Deployment Acceptance

Purpose: answer "can this repository produce and run a production-style private stack, and does it fail closed when risky config is missing?"

Checks:

- `docker compose --env-file .env.production -f docker-compose.prod.yml config` with a generated local dry-run env.
- `docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate`.
- Start `postgres` and `redis`; run `migrate`; start `web`; verify container health.
- `curl /readiness` returns HTTP 200 with database and Redis ok.
- `curl /login` returns HTTP 200.
- Env fail-close probes:
  - Missing `ACCESS_JWT_SECRET` fails.
  - `WECHAT_PAY_USE_MOCK=false` without real fields fails after base env is complete.
  - `SMS_USE_MOCK=false`, `WECHAT_OAUTH_USE_MOCK=false`, `AI_USE_MOCK=false`, and `STORAGE_USE_MOCK=false` each require their real fields or fail explicitly.
- Production guard probes:
  - E2E hooks return 404 when `E2E_TEST_HOOKS` is not enabled.
  - `/demo` is unavailable when `DEMO_MODE=0`.
  - Real OSS stub throws `NOT_IMPLEMENTED` instead of silently accepting writes.
- Operational docs line up with actual commands and observed results.

Expected result: the private stack can be built, migrated, started, and smoke-tested with mock adapters, while external-real modes fail clearly until credentials and implementations exist.

### Pass A: Local Demo/Internal-test Acceptance

Purpose: answer "can this be demonstrated reliably to a small internal audience?"

Checks:

- `pnpm demo:reset` and `pnpm verify:demo`.
- `/demo` role entries for student, teacher, and parent.
- Student demo:
  - Text tutor hint-first flow.
  - Image/OCR tutor upload, transcript, and text re-ask path.
  - Error analysis, error-book link, variants, targeted training, and learning portrait.
- Teacher demo:
  - Teacher dashboard/class workspace.
  - Tiered assignment draft/publish.
  - Student submission visibility.
  - Manual grading and wrong/partial writeback to error book.
- Parent demo:
  - Parent entry and child learning view.
  - Binding/consent flows only where deterministic hooks or seeded data make them stable.
- E2E:
  - Full web E2E should pass once as a single run.
  - Focused demo/product E2E specs should pass individually when isolating failures.
- Copy and compliance:
  - Demo text avoids score guarantees, fear framing, and answer-copying positioning.
  - Preview-only AI paper/courseware cards remain preview-only.

Expected result: a local/internal user can enter demo mode and traverse the main loops without manual database surgery or hidden setup.

## Outcome Model

Each check records one of four statuses:

| Status | Meaning | Action |
|---|---|---|
| `Pass` | The check ran and matched expected behavior. | Record evidence. |
| `Needs fix` | The check exposes a repo-controlled defect. | Fix or create a narrow follow-up task. |
| `Blocked by external` | The check depends on ICP, credentials, public domain, merchant config, or real OSS. | Document as launch blocker, do not fake completion. |
| `Out of scope` | The check belongs to a later plan or public launch work. | Keep out of this acceptance plan. |

The final report must not flatten external blockers into failures. A private dry-run can be go even when public launch is no-go.

## Deliverables

- Implementation/verification plan: `docs/superpowers/plans/2026-06-04-launch-readiness-and-demo-acceptance.md`.
- Acceptance report, written after execution, in `docs/ops/launch-readiness-report.md`.
- Updated `docs/claude/implementation-state.md` with launch-readiness facts and residual blockers.
- Updated `docs/claude/merge-verification.md` only if this work creates durable new probes.
- Code or doc fixes only when acceptance exposes a concrete repo-controlled problem.

## Testing Strategy

The implementation plan should order verification from infrastructure to product:

1. Static config and build checks.
2. Production-style compose smoke.
3. Env fail-close and guardrail probes.
4. Unit/integration/typecheck regression.
5. Demo reset and demo verification.
6. Full E2E and focused product-loop E2E.
7. Manual or scripted report synthesis.

Commands that mutate Docker containers or volumes must use clearly named local dry-run resources and clean them up after evidence is captured. E2E must not run concurrently with builds or other commands that write `.next`.

## Risks

- Docker smoke can be slow and may require cleanup if interrupted.
- Env fail-close checks can be misleading if base env is incomplete; the implementation plan must inject full base env before removing the one target variable under test.
- E2E and OTP flows are sensitive to shared seed users; focused specs should use the documented isolated seed identities.
- Public launch remains blocked even if this acceptance passes, because ICP/domain/TLS and real provider credentials are outside this track.

## Acceptance Criteria

- Pass B has a documented result for every deployment, env, readiness, and guardrail check.
- Pass A has a documented result for demo reset, demo verify, role entry, and main product loops.
- Any repo-controlled failure is either fixed in this track or explicitly converted into a small follow-up with file/test references.
- External blockers are named precisely and kept separate from repo defects.
- The final report gives a clear private-dry-run verdict and a separate public-launch verdict.
