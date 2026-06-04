# Public Launch Blockers

Date: 2026-06-04

This checklist starts after private production-style readiness has passed.
`docs/ops/launch-readiness-report.md` is the evidence for that local acceptance.
This document tracks what still blocks a public internet launch.

## Current Launch Decision

- Private Docker dry run: ready.
- Local demo/internal-test: ready.
- Public launch: blocked.

Public launch stays blocked until every item below has an owner, credentials,
implementation status, smoke evidence, and rollback notes.

## Workstream Matrix

| Workstream | Type | Current State | Exit Criteria |
| --- | --- | --- | --- |
| ICP, domain, TLS, reverse proxy | External + ops | Not done | Public HTTPS domain resolves to the app, ICP details are publishable, `/readiness` and `/login` pass through the public URL. |
| Production secrets injection | Ops | Env checker exists; production `.env.production` still must be supplied on the host | Deployment host has non-dev `.env.production`, `scripts/check-production-env.ps1` passes, secret ownership is documented, no placeholder values remain. |
| Database backup and restore | Ops | Local rehearsal passed; production-host rehearsal still required | A backup file is created, restore is rehearsed on production-equivalent data, and the operator records the restore stamp. |
| Real AI | External + smoke | Adapter exists; needs credentials | `AI_USE_MOCK=false` with DashScope credentials boots and a paid tutor flow succeeds. |
| Real SMS | External + code | Credentials env gate exists; adapter send path is still not implemented | Aliyun SMS send is implemented, `SMS_USE_MOCK=false` boots, login OTP delivery succeeds to an allowlisted phone. |
| Real WeChat OAuth | External + code | OAuth URL build exists; code exchange is still not implemented | `WECHAT_OAUTH_USE_MOCK=false` boots, bind/login callback exchanges a real code and stores `AuthIdentity`. |
| Real WeChat Pay | External + code | Billing state machine exists; V3 adapter is still not implemented | `WECHAT_PAY_USE_MOCK=false` boots, unified order returns a real prepay result, notify verification credits wallet exactly once. |
| Real OSS | External + code | Env gate exists; `put`/`getBytes` are still `NOT_IMPLEMENTED` | `STORAGE_USE_MOCK=false` boots, image upload stores bytes, AI tutor can read them back. |
| Public legal/support details | External + product ops | Not done | Public support contact, operating entity, ICP number, privacy terms, and refund/support flow are visible. |

## External Application Track

These can move in parallel with engineering work, but public launch cannot
complete without them.

### ICP, Domain, TLS

Required inputs:

- Domain selected and owned by the operating entity.
- ICP filing completed for the domain.
- TLS certificate issued and renewable.
- Reverse proxy or load balancer chosen for HTTPS termination.

Exit smoke:

```powershell
curl.exe -fsS https://<public-domain>/readiness
curl.exe -I https://<public-domain>/login
```

Expected:

- `/readiness` returns HTTP 200 with `ok=true`, `database.ok=true`, and
  `redis.ok=true`.
- `/login` returns HTTP 200.

### SMS Provider

Required inputs:

- `ALIYUN_SMS_ACCESS_KEY_ID`
- `ALIYUN_SMS_ACCESS_KEY_SECRET`
- `ALIYUN_SMS_SIGN_NAME`
- `ALIYUN_SMS_TEMPLATE_CODE`

Code status:

- `apps/web/server/env.ts` already fail-closes when `SMS_USE_MOCK=false` and
  these values are missing.
- `packages/integrations/src/sms/aliyun.ts` still throws
  `AliyunSmsAdapter.send not implemented yet`.

Exit smoke:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/sms-aliyun.test.ts
```

Then on a staging host with real credentials:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
curl.exe -fsS http://127.0.0.1:3000/readiness
```

Manual check:

- Trigger login OTP to an allowlisted phone.
- Confirm one SMS arrives.
- Confirm OTP login succeeds.

### WeChat H5 OAuth

Required inputs:

- `WECHAT_H5_APPID`
- `WECHAT_H5_SECRET`
- Public callback domain configured in the official account platform.

Code status:

- `packages/integrations/src/wechat/h5-oauth/real.ts` can build an authorize
  URL.
- `exchangeCodeForUser` still throws `RealWechatH5Adapter.exchangeCodeForUser
  not implemented yet`.

Exit smoke:

- `WECHAT_OAUTH_USE_MOCK=false` boots without env validation failure.
- Start WeChat bind flow from a logged-in test user.
- Complete callback through the public domain.
- Confirm `AuthIdentity(provider=WECHAT_H5)` is stored for that user.

### WeChat Pay

Required inputs:

- `WECHAT_PAY_APPID`
- `WECHAT_PAY_MCHID`
- `WECHAT_PAY_API_V3_KEY`
- `WECHAT_PAY_PRIVATE_KEY`
- `WECHAT_PAY_CERT_SERIAL`
- `WECHAT_PAY_PUB_KEY_FILE`
- `WECHAT_PAY_NOTIFY_HOST`

Code status:

- Billing order, ledger, idempotency, notify state machine, and mock pay path
  are implemented and tested.
- `packages/integrations/src/wechat-pay/real.ts` still throws for
  `unifiedOrder` and `verifyNotify`.

Exit smoke:

- `WECHAT_PAY_USE_MOCK=false` boots without env validation failure.
- Create a small top-up order.
- Pay through the real provider sandbox or production allowlist.
- Notify endpoint records a `WechatPayEvent`.
- Wallet balance increases once.
- Replayed notify returns success without duplicate credit.

### OSS/CDN

Required inputs:

- `ALIYUN_OSS_ACCESS_KEY_ID`
- `ALIYUN_OSS_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_REGION`
- `ALIYUN_OSS_ENDPOINT`
- CDN domain and bucket policy, if public delivery is needed.

Code status:

- `apps/web/server/env.ts` already fail-closes when `STORAGE_USE_MOCK=false`
  and OSS values are missing.
- `packages/integrations/src/storage/real.ts` still throws `NOT_IMPLEMENTED`
  for `put` and `getBytes`.

Exit smoke:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/storage.test.ts
```

Then on staging with real credentials:

- Upload an image in image tutor.
- Confirm the object exists in OSS.
- Confirm the AI tutor flow can read the stored bytes back.

## Engineering Track

These are the items that can start before external approvals finish.

### 1. Production Secrets Checklist

Create the deployment `.env.production` from `.env.production.example` and
replace every placeholder.

Must not contain:

- `replace-with-`
- `placeholder`
- dev/test-only secret strings
- mock credentials used by E2E

Required private values:

- `POSTGRES_PASSWORD`
- `ACCESS_JWT_SECRET`
- `OTP_PEPPER`
- `MOCK_WECHAT_PAY_SECRET` while pay is still mocked
- `DASHSCOPE_API_KEY` when `AI_USE_MOCK=false`

Suggested verification:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-production-env.ps1 -Path .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

### 2. Backup/Restore Rehearsal

Use `docs/ops/production-deploy.md` as the command source.

Local rehearsal evidence is recorded in
`docs/ops/backup-restore-rehearsal.md`. This proves the runbook shape works in
an isolated Docker project, but it does not replace the final rehearsal on the
real production host.

Exit evidence:

- Backup file path.
- Backup file byte size.
- Restore target environment.
- `/readiness` result after restore.
- One minimal authenticated flow checked after restore.

### 3. Real Adapter Activation Plans

Implement in this order:

1. OSS real adapter.
2. Aliyun SMS adapter.
3. WeChat OAuth real code exchange.
4. WeChat Pay V3 unified order and notify verification.

Reasoning:

- OSS and SMS are narrower integrations with direct smoke tests.
- WeChat OAuth adds account identity risk.
- WeChat Pay has money movement, webhook replay, certificate, and idempotency
  risk, so it should be last and tested most heavily.

Each adapter activation should follow this pattern:

- Add failing tests around real-mode construction and provider request mapping.
- Implement only the provider calls needed for the current product flow.
- Add a staging smoke command or manual runbook section.
- Keep mock mode as the default in local/E2E.
- Update `.env.production.example` comments if the provider needs a file path,
  callback URL, or domain-level setting.

### 4. Public Product/Legal Surface

Before public traffic:

- Public support contact.
- Operating entity name.
- ICP number display location.
- Privacy policy and terms entry points.
- Refund/support path for wallet top-ups.
- Incident contact and rollback owner.

## Release Gate

Do not switch public traffic until all gates pass:

- `docker compose --env-file .env.production -f docker-compose.prod.yml config`
- `docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate build web migrate`
- Backup created and restore rehearsal documented.
- Migrations applied on staging.
- `/readiness` passes through public HTTPS.
- `/login` passes through public HTTPS.
- Demo routes stay disabled with `DEMO_MODE=0`.
- E2E hooks stay disabled with `E2E_TEST_HOOKS=0`.
- Real-mode adapter smoke evidence exists for every `*_USE_MOCK=false`.

## Recommended Next Engineering Task

Start with production secrets and backup/restore rehearsal because both are
required regardless of external approval timing. After that, implement the OSS
real adapter first because image tutor already depends on storage roundtrips and
the current real adapter explicitly throws `NOT_IMPLEMENTED`.
