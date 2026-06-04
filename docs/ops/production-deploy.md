# Production Deployment Skeleton

This runbook covers the deployable Docker shape that is available before ICP,
domain, TLS, real SMS, real WeChat Pay, and real OSS are finished. It is a
production-style skeleton, not a public launch checklist.

## What This Provides

- `docker-compose.prod.yml` runs `web`, `postgres` with pgvector, and `redis`.
- The `web` service uses the root `Dockerfile` `runner` target.
- The `migrate` service uses the same Dockerfile `migrator` target and runs
  `pnpm exec prisma migrate deploy` from `/app/packages/db`.
- Postgres and Redis are internal services only. Do not publish them publicly.
- TLS/reverse proxy is intentionally out of scope until the real domain and ICP
  state are known.

## Files

- `Dockerfile`: production web image and migrator target.
- `docker-compose.prod.yml`: production-style service graph.
- `.env.production.example`: copyable deployment environment template.
- `.github/workflows/ci.yml`: validates compose config and builds both image
  targets on every push/PR.

## First Deploy On A Docker Host

Run from the repository root on the host.

```powershell
Copy-Item .env.production.example .env.production
notepad .env.production
```

Replace every placeholder in `.env.production`. At minimum, change:

- `POSTGRES_PASSWORD`
- `NEXT_PUBLIC_APP_URL`
- `ACCESS_JWT_SECRET`
- `OTP_PEPPER`
- `MOCK_WECHAT_PAY_SECRET`
- `DASHSCOPE_API_KEY` when `AI_USE_MOCK=false`

Validate the compose file:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

Build images:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate
```

Start database services:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
```

Run migrations:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate run --rm migrate
```

Start the app:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
```

Check status:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl.exe -i http://127.0.0.1:3000/readiness
curl.exe -i http://127.0.0.1:3000/login
```

## First Deploy Smoke Checklist

Run these checks before treating a host as usable:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl.exe -fsS http://127.0.0.1:3000/readiness
curl.exe -fsS http://127.0.0.1:3000/login
```

Expected results:

- `config` exits 0 and shows no unresolved placeholders.
- `postgres`, `redis`, and `web` are healthy.
- `/readiness` returns HTTP 200 with `database.ok=true` and `redis.ok=true`.
- `/login` returns HTTP 200.

For private dry-runs before public launch, also complete one seeded/mock login
flow and one tutoring request before handing the host to anyone else.

## Backup Before Migration

Create a database backup before every production migration or risky deploy.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force backups
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl' > "backups\zhijiao-$stamp.sql"
```

Verify that the file exists and is non-empty:

```powershell
Get-Item "backups\zhijiao-$stamp.sql" | Select-Object FullName,Length
```

Keep at least the latest pre-migration dump outside the deployment directory so
a failed host disk or accidental cleanup cannot remove the only recovery copy.

## Update Deploy

```powershell
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl.exe -fsS http://127.0.0.1:3000/readiness
```

## Rollback

Use the previous good commit SHA.

```powershell
git checkout <previous-good-sha>
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
```

Only run rollback migrations if a future migration explicitly documents a
rollback path. Prisma `migrate deploy` is forward-only by design.

## Restore From Backup

Use restore only when you intentionally want to replace the database contents
with a known backup. Stop the web process first so no requests write during the
restore.

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml stop web
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
Get-Content "backups\zhijiao-<stamp>.sql" | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
curl.exe -fsS http://127.0.0.1:3000/readiness
```

After restore, check login and a minimal authenticated flow before resuming
normal traffic.

## Launch Blockers Still Outside This Skeleton

The actionable checklist lives in `docs/ops/public-launch-blockers.md`.

- ICP/domain/TLS/reverse proxy.
- Real Aliyun SMS credentials and `SMS_USE_MOCK=false`.
- Real WeChat OAuth credentials and `WECHAT_OAUTH_USE_MOCK=false`.
- Real WeChat Pay merchant credentials/certificates and
  `WECHAT_PAY_USE_MOCK=false`.
- Real OSS implementation and `STORAGE_USE_MOCK=false`.
- Official support page details: public support contact, operating entity, and
  ICP number.

Until those are done, treat this compose stack as a private dry-run/staging
deployment shape.
