# Production Secrets And Backup Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator-safe production env checker and document a completed local backup/restore rehearsal.

**Architecture:** Keep the env checker as a repository-level PowerShell script with no runtime app dependency. Run backup/restore against an isolated Docker Compose project and record evidence in ops docs.

**Tech Stack:** PowerShell, Docker Compose, Postgres `pg_dump`/`psql`, existing `docker-compose.prod.yml`.

---

### Task 1: Production Env Checker

**Files:**
- Create: `scripts/check-production-env.ps1`

- [x] Add a parser for `.env.production`-style `KEY=value` files.
- [x] Fail on missing required base variables.
- [x] Fail on placeholder/dev/test-looking secret values.
- [x] Mirror real-mode gates for `AI_USE_MOCK`, `SMS_USE_MOCK`,
  `WECHAT_OAUTH_USE_MOCK`, `WECHAT_PAY_USE_MOCK`, and `STORAGE_USE_MOCK`.
- [x] Verify with one bad sample and one good sample.

### Task 2: Backup/Restore Rehearsal

**Files:**
- Create: `docs/ops/backup-restore-rehearsal.md`
- Modify: `docs/ops/public-launch-blockers.md`
- Modify: `docs/ops/production-deploy.md`

- [x] Create a temporary `.backup-rehearsal.env` in the worktree.
- [x] Start `postgres` and `redis` with compose project
  `zhijiao-backup-rehearsal`.
- [x] Run the official migrator.
- [x] Write a rehearsal marker row.
- [x] Dump the database to a local backup file. `D:\tmp` was not writable, so
  the rehearsal used `backups\rehearsal` in the isolated worktree.
- [x] Drop and recreate the database.
- [x] Restore from the dump and verify the marker row.
- [x] Clean up compose volumes and temporary env.
- [x] Record evidence and remaining production-host follow-up.

### Task 3: Verification And Handoff

- [x] Run `git diff --check`.
- [ ] Commit the script and docs.
- [ ] Merge back to `master` without touching root `CLAUDE.md`.
- [ ] Push `master`.
