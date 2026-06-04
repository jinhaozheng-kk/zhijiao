# Backup Restore Rehearsal

Date: 2026-06-04

Scope: local rehearsal of the production database backup and restore runbook
using an isolated Docker Compose project. This does not replace a rehearsal on
the real production host.

## Verdict

- Local backup/restore rehearsal: PASS.
- Production-host backup/restore rehearsal: still required before public launch.

## Environment

- Worktree: `D:\智教\.worktrees\production-ops-rehearsal`
- Compose project: `zhijiao-backup-rehearsal`
- Compose file: `docker-compose.prod.yml`
- Temporary env file: `.backup-rehearsal.env`
- Services started: `postgres`, `redis`, one-off `migrate`
- Services not started: `web`

The rehearsal used mock integrations and production-style database/Redis
containers. The temporary env and compose volumes were removed after the run.

## Commands Verified

Production env checker:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-production-env.ps1 -Path .env.production.example
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-production-env.ps1 -Path .backup-rehearsal.env
```

Observed:

- `.env.production.example` failed as expected with six placeholder-looking
  values.
- `.backup-rehearsal.env` passed.

Compose and migration:

```powershell
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml config
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml --profile migrate build migrate
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml up -d postgres redis
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml --profile migrate run --rm migrate
```

Observed:

- Compose config passed.
- Migrator image built from cache.
- Postgres and Redis became healthy.
- Official migrator applied all 16 migrations.

Backup and restore:

```powershell
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml exec -T postgres psql -U postgres -d zhijiao -v ON_ERROR_STOP=1 -c "<create marker table and row>"
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl > /tmp/zhijiao-backup-rehearsal.sql'
docker cp <postgres-container>:/tmp/zhijiao-backup-rehearsal.sql backups\rehearsal\zhijiao-backup-rehearsal-20260604-155841.sql
docker cp backups\rehearsal\zhijiao-backup-rehearsal-20260604-155841.sql <postgres-container>:/tmp/restore.sql
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml exec -T postgres sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/restore.sql >/tmp/restore.log'
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml exec -T postgres psql -U postgres -d zhijiao -tAc "SELECT note FROM ops_backup_rehearsal WHERE id = '2026-06-04-local-backup-restore-rehearsal';"
```

Observed:

- Backup file size: 86,535 bytes.
- Restored marker value: `local backup restore rehearsal`.
- Restore path confirmed that data written before the dump was present after
  dropping, recreating, and restoring the database.

Cleanup:

```powershell
docker compose -p zhijiao-backup-rehearsal --env-file .backup-rehearsal.env -f docker-compose.prod.yml down -v
```

Observed:

- Temporary containers, network, Postgres volume, and Redis volume were removed.
- Temporary env file and local backup copy were removed from the worktree.

## Local Machine Note

Writing the backup copy to `D:\tmp` failed with `Access is denied`. The
rehearsal used `backups\rehearsal` inside the isolated worktree instead. On a
real production host, the backup destination must be explicitly created,
writable by the operator, and copied outside the deployment directory.

## Production Follow-Up

Before public launch, repeat this rehearsal on the actual production host or an
equivalent staging host:

- Use the real `.env.production`.
- Store the dump outside the deployment directory.
- Record the backup path, byte size, restore target, operator, and timestamp.
- Start `web` after restore and verify `/readiness`, `/login`, and one minimal
  authenticated flow.
