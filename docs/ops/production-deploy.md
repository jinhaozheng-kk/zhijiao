# Production Deployment Skeleton

This runbook covers the deployable Docker shape that is available before ICP,
domain, TLS, real SMS, real WeChat Pay, and real OSS are finished. It is a
production-style skeleton, not a public launch checklist.

## What This Provides

- `docker-compose.prod.yml` runs `web`, `postgres` with pgvector, and `redis`.
- The `web` service uses the root `Dockerfile` `runner` target.
- The `migrate` service uses the same Dockerfile `migrator` target and runs
  `pnpm --filter @zhijiao/db db:migrate:deploy`.
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
curl.exe -i http://127.0.0.1:3000/login
```

## Update Deploy

```powershell
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
docker compose --env-file .env.production -f docker-compose.prod.yml ps
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

## Launch Blockers Still Outside This Skeleton

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
