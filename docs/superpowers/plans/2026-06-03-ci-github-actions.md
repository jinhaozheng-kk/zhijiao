# CI GitHub Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first GitHub Actions CI workflow that runs the existing `typecheck` and unit/integration test suites on every push and pull request.

**Architecture:** Reuse the repository's existing `docker-compose.yml` to start Postgres with pgvector and Redis on the Ubuntu runner, then run the same `pnpm test:setup`, `pnpm typecheck`, and `pnpm test` commands used locally. Keep E2E, lint, Docker image builds, and deployment out of this first CI pass.

**Tech Stack:** GitHub Actions, Ubuntu runner, Docker Compose, Node 20, Corepack, pnpm 9, Turbo, Vitest, Prisma/Postgres, Redis.

---

## File Structure

- Modify `packages/db/scripts/setup-test-dbs.ts` to choose `pnpm` vs `pnpm.cmd` by platform before invoking Prisma migrations.
- Add `packages/db/tests/setup-test-dbs-script.test.ts` as a small regression guard for the Linux CI portability fix.
- Create `.github/workflows/ci.yml` with one `test` job.
- No E2E workflow, Dockerfile, deployment config, branch protection, or remote Turbo cache in this plan.

---

### Task 1: Make `setup-test-dbs.ts` Cross-Platform

**Files:**
- Modify: `packages/db/scripts/setup-test-dbs.ts`
- Test: `packages/db/tests/setup-test-dbs-script.test.ts`

- [ ] **Step 1: Write the failing regression test**

Create `packages/db/tests/setup-test-dbs-script.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm.cmd --filter @zhijiao/db test -- tests/setup-test-dbs-script.test.ts
```

Expected: FAIL because `setup-test-dbs.ts` still hardcodes `pnpm.cmd` and does not contain the platform selector.

- [ ] **Step 3: Patch the script**

In `packages/db/scripts/setup-test-dbs.ts`, replace the `execSync` import and migrate command with `execFileSync`.

Change the import:

```ts
import { execFileSync, spawnSync } from "node:child_process";
```

Add this near the other constants:

```ts
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
```

Replace `migrate(name: string)` with:

```ts
function migrate(name: string): void {
  const url = dbDsn(name);
  console.log(`[setup-test-dbs] migrating ${name} …`);
  execFileSync(PNPM_BIN, ["--filter", "@zhijiao/db", "db:migrate:deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
```

This avoids shell string parsing and lets Linux CI call `pnpm` while Windows keeps using `pnpm.cmd`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm.cmd --filter @zhijiao/db test -- tests/setup-test-dbs-script.test.ts
pnpm.cmd --filter @zhijiao/db typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/setup-test-dbs.ts packages/db/tests/setup-test-dbs-script.test.ts
git commit -m "fix(db): make test DB setup use platform pnpm binary"
```

---

### Task 2: Add the GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    name: Typecheck and test
    runs-on: ubuntu-latest
    timeout-minutes: 30

    env:
      PGHOST: 127.0.0.1
      PGPORT: "5432"
      PGUSER: postgres
      PGPASSWORD: postgres
      REDIS_URL: redis://127.0.0.1:6379

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Start Postgres and Redis
        run: docker compose up -d

      - name: Wait for containers
        shell: bash
        run: |
          set -euo pipefail
          for container in zhijiao-postgres zhijiao-redis; do
            echo "Waiting for ${container} to become healthy..."
            for i in {1..30}; do
              status="$(docker inspect -f '{{.State.Health.Status}}' "${container}" 2>/dev/null || true)"
              if [ "${status}" = "healthy" ]; then
                echo "${container} is healthy"
                break
              fi
              sleep 2
            done
            final_status="$(docker inspect -f '{{.State.Health.Status}}' "${container}")"
            if [ "${final_status}" != "healthy" ]; then
              docker compose ps
              docker compose logs "${container}"
              exit 1
            fi
          done

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Enable pnpm
        run: |
          corepack enable
          corepack prepare pnpm@9.0.0 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Prepare test databases
        run: pnpm test:setup

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Stop containers
        if: always()
        run: docker compose down -v
```

- [ ] **Step 2: Check workflow syntax locally by inspection**

Run:

```bash
Get-Content -Path .github\workflows\ci.yml
```

Expected: the file contains exactly one workflow named `CI`, one job named `test`, and no `test:e2e`, `lint`, Docker build, deployment, or secret-dependent steps.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run typecheck and tests on push and PR"
```

---

### Task 3: Push `ci-bootstrap` and Iterate on CI Logs

**Files:**
- No planned file changes unless the first GitHub Actions run exposes an environment or container readiness issue.

- [ ] **Step 1: Push the branch**

Run:

```bash
git push -u origin ci-bootstrap
```

Expected: GitHub creates a CI run for the `ci-bootstrap` push.

- [ ] **Step 2: Inspect the GitHub Actions result**

Use the GitHub web UI or `gh` if available:

```bash
gh run list --branch ci-bootstrap --limit 5
gh run view --log
```

Expected: one `CI / Typecheck and test` run appears for the branch.

- [ ] **Step 3: If the run fails before `Prepare test databases`, fix only container/setup issues**

Likely failures and fixes:

- If Docker Compose reports an unsupported command, replace `docker compose` with the runner-supported invocation shown in the Actions log.
- If health waits time out, increase the wait loop from `{1..30}` to `{1..60}` and keep the failure logs.
- If Postgres is healthy but `docker exec zhijiao-postgres` cannot find the container, confirm the workflow is running from the repo root and `docker-compose.yml` still sets `container_name: zhijiao-postgres`.

After any fix:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: harden compose readiness on GitHub runner"
git push
```

- [ ] **Step 4: If the run fails during `Prepare test databases`, fix only test DB setup issues**

Likely failures and fixes:

- If `pnpm` is not found inside `setup-test-dbs.ts`, re-check Task 1's `PNPM_BIN` patch and the `Enable pnpm` workflow step.
- If Prisma migration cannot create pgvector objects, inspect the failing migration and add the minimum missing `CREATE EXTENSION IF NOT EXISTS vector;` to the relevant migration only if the migration currently assumes it exists.
- If `psql` fallback fails, keep the `docker exec -i zhijiao-postgres psql ...` path rather than installing host `psql`; the chosen design intentionally relies on the compose container.

After any fix:

```bash
git add packages/db/scripts/setup-test-dbs.ts packages/db/prisma/migrations .github/workflows/ci.yml
git commit -m "ci: fix test database setup on GitHub runner"
git push
```

- [ ] **Step 5: If the run fails during `Typecheck` or `Test`, fix the actual regression**

Do not weaken CI to hide a failing package. Reproduce locally with the closest focused command from the CI log, then patch the affected package.

Typical commands:

```bash
pnpm.cmd --filter @zhijiao/web test -- <failing-test-file>
pnpm.cmd --filter @zhijiao/db typecheck
pnpm.cmd typecheck
pnpm.cmd test
```

Commit with a message that names the package and failure, for example:

```bash
git add <changed-files>
git commit -m "fix(web): make auth integration test deterministic in CI"
git push
```

- [ ] **Step 6: Stop after one full green CI run**

Acceptance criteria:

- GitHub Actions run is green on `ci-bootstrap`.
- `Prepare test databases` creates/migrates all 6 per-package DBs.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- No E2E, lint, Docker build, deployment, secrets, or branch protection were added.

---

### Task 4: Merge Back to `master`

**Files:**
- No planned file changes.

- [ ] **Step 1: Confirm local branch state**

Run:

```bash
git status --short --branch
```

Expected: `## ci-bootstrap...origin/ci-bootstrap` with no uncommitted files.

- [ ] **Step 2: Update local `master`**

Run:

```bash
git checkout master
git pull --ff-only origin master
```

Expected: local `master` matches `origin/master`.

- [ ] **Step 3: Merge with a no-fast-forward commit**

Run:

```bash
git merge --no-ff ci-bootstrap -m "merge: ci bootstrap"
```

Expected: merge succeeds without conflicts.

- [ ] **Step 4: Push master**

Run:

```bash
git push origin master
```

Expected: GitHub creates a CI run for `master`.

- [ ] **Step 5: Confirm master CI is green**

Use GitHub Actions UI or:

```bash
gh run list --branch master --limit 5
```

Expected: the first `master` CI run after merge is green.

---

## Self-Review

- **Spec coverage:** The plan implements the single-job GitHub Actions workflow, `push` + `pull_request` triggers, Docker Compose Postgres/Redis startup, Node 20 + pnpm 9 setup, pnpm store cache, `pnpm test:setup`, `pnpm typecheck`, and `pnpm test`. E2E, lint, Dockerfile, deployment, true integrations, remote Turbo cache, matrices, and branch protection remain out of scope.
- **Placeholder scan:** No `TBD`, `TODO`, vague "add tests", or undefined implementation steps remain. CI log iteration is bounded to concrete failure classes and commit commands.
- **Type consistency:** The cross-platform script uses `PNPM_BIN` with `execFileSync`; the workflow calls `pnpm test:setup`, so Linux CI reaches the `pnpm` branch while Windows keeps `pnpm.cmd`. The workflow uses the existing compose container names `zhijiao-postgres` and `zhijiao-redis`, matching `docker-compose.yml` and `setup-test-dbs.ts`.
