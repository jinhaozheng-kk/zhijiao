---
title: 智教 — Plan 2 Hardening 设计 Spec
date: 2026-05-20
status: draft (awaiting review)
scope: Plan 2 真鉴权落地后的安全 / 并发 / 契约 / 覆盖缺口修复
audience: 实施者（Claude Code）、用户（产品/架构审核者）
source: 2026-05-20 三个只读 subagent 审计 + 主线 spot-check（详见 §1.2）
amends:
  - 2026-05-19-real-auth-design.md（不替换；本文是其增量加固）
---

# 智教 · Plan 2 Hardening 设计

## 0. 文档信息

**目标**：把 Plan 2 merge 后留下的 3 项 Critical + 4 项 Important + 一组覆盖/契约缺口修干净，再放行 Plan 3/4；Plan 5（真接 SMS/微信公众号）必须在本 plan 之后才能开。

**范围**：
- ✅ 包含：env fail-close 与启动时校验、WeChat OAuth 静默 mock 兜底消除、WeChat 真实 callback 路径对账、refresh 轮换原子化、OTP 校验原子化、会话吊销后旧 JWT 立刻失效、bind callback 重新校验当前 access JWT、register/refresh 限频接入、middleware/bind/OTP/race 测试矩阵补齐、`.claude/worktrees/` + `.claire/` 入 `.gitignore` + 残留物清理。
- ❌ 不包含：Credit 体系（Plan 3）、举一反三与错因（Plan 4）、真接阿里云 SMS / 微信公众号（Plan 5）、CSRF double-submit token（仍按 SameSite + 窄路径 Path=/api/auth 兜底，未来 Plan 视风险面再加）、设备指纹 / 风控、apps/admin。

**前置依赖**：
- Plan 2 已落地（commit `4dc55a4`，master）
- Spec：`docs/superpowers/specs/2026-05-19-real-auth-design.md`（本文不替换它，是其增量；冲突时以本文为准）

---

## 1. 问题盘点（审计来源 → 现场代码）

### 1.1 三只读 subagent 的审计输出

2026-05-20 用户用三个只读 subagent 并行查验：(a) 证据/绿测试是否可证实、(b) auth 安全面、(c) Plan 对齐与覆盖面。主线又跑了 5 个独立 spot-check 复核了最关键位置，全部对得上。下表把每个问题钉到具体文件:行。

| ID | 级别 | 问题 | 现场 |
|---|---|---|---|
| C1 | Critical | `ACCESS_JWT_SECRET ?? ""`：env 漏配时 JWT 用空串签名/校验，任何持空串签名的 token 都过 | `apps/web/server/auth-service.ts:32`、`apps/web/server/context.ts:40`、`apps/web/app/api/auth/refresh/route.ts:25`、`apps/web/app/(auth)/wechat/start/route.ts:17` |
| C2 | Critical | WeChat OAuth 静默兜底 Mock：`!env.WECHAT_H5_APPID` 即返回 `MockWechatH5Adapter`，prod 漏 APPID → 任何人 mock-login | `packages/integrations/src/wechat/h5-oauth/build.ts:6-8` |
| C3 | Critical | 真实 WeChat callback URL 拼为 `${appUrl}/auth/wechat/callback`，但实际路由是 `/wechat/callback`（`(auth)` 是 Next.js route group，不进 URL），真公众号回调将 404 | `packages/integrations/src/wechat/h5-oauth/build.ts:13` vs `apps/web/app/(auth)/wechat/callback/route.ts` |
| I1 | Important | refresh 轮换非原子：`findUnique` 在 `$transaction` 外，两条并发 refresh 同时读到 `revokedAt==null` → 各自 revoke + create new → 拿到两个新 session，且不会触发 REUSE_DETECTED | `packages/auth/src/session.ts:29-75` |
| I2 | Important | OTP 校验非原子：`findFirst (consumedAt:null)` → `update attempts` → `update consumedAt` 是三独立写，并发同码两条都过 findFirst 且都过 hash 比对 → 一码被消费多次 | `packages/auth/src/otp.ts:43-65` |
| I3 | Important | 会话吊销后旧 access JWT 仍可用最多 15 分钟，因为 context 只 `verifyAccess`，从不查 `Session.revokedAt` | `apps/web/server/context.ts:33-46` |
| I4 | Important | bind callback 信任 `state.userId`：若旧 state cookie 被偷或被构造，攻击者可把自己的 WeChat 绑到他人账号；从未在 callback 时重新校验当前 access JWT | `apps/web/app/(auth)/wechat/callback/route.ts:47-51` |
| G1 | Gap | `RULE_REGISTER_IP` / `RULE_REFRESH` 在 `rules.ts` 定义齐全，但 `auth.register` procedure 与 `/api/auth/refresh` route handler 从未 `takeRule` 调用 | `packages/auth/src/ratelimit/rules.ts:6-7` 与 `apps/web/server/routers/auth.ts:111-`、`apps/web/app/api/auth/refresh/route.ts:12-` |
| G2 | Gap | middleware route guard 无集成测试。**实际保护路径**：`/profile`、`/error-book`、`/teacher`、`/parent`、`/admin`（`apps/web/middleware.ts:3`）；`/tutor` **不在** middleware 保护范围（由 tRPC `authedProcedure` 在数据路径上拦） | `apps/web/middleware.ts` |
| G3 | Gap | bind callback 路径无测试（noop / conflict / state_lost / 跨用户绑定拒绝） | — |
| G4 | Gap | OTP 边界无测试：MAX_ATTEMPTS 触发、已 consumed 重放、已 expired 验证、跨 phone 串验证 | — |
| G5 | Gap | 并发 race 无测试：concurrent refresh、concurrent OTP verify、concurrent register（同一 nonce）—— 最后一个在 Plan 2 已有但 race 等价的 refresh/OTP 没补 | — |
| H1 | Hygiene | `.claude/worktrees/plan-2-real-auth/` 残留断 symlink 让 `git status` 出 `??`；`.claire/`、`.claude/worktrees/` 均未进 `.gitignore` | `.gitignore` |

### 1.2 主线 spot-check 复核

主线读了 5 个文件 × 关键行段，确认上表 C1-C3、I1-I2 全部对得上。C2 还顺手注意到一个隐性问题：`MockWechatH5Adapter` 构造时取 `env.WECHAT_H5_APPID || "wx-mock-app"`——prod 漏配 APPID 时连 appId 都是默认值 `"wx-mock-app"`，写入 `AuthIdentity.providerScope` 后会让"未来某天补回真 APPID"的迁移更难做（数据已经污染）。本文 §3.2 一并解决。

### 1.3 我之前 recap 的方法论问题（留底，避免再犯）

我在 2026-05-20 早晨给出"测试 6/6 绿 → 可以进 Plan 3/4/5"是错误判断。**测试全绿** 与 **系统就绪进下一阶段** 不是同一件事。绿测试只覆盖：
- happy path
- 已写出来的 case

它对以下完全无表态：
- env 缺省下的 fail-open vs fail-close 行为
- 跨进程 / 并发的 race（refresh / OTP / register）
- 路由与外部回调 URL 的契约对账
- 失效语义（revoke 后的可用窗口）
- "规则定义了" 与 "规则接入了" 的双向匹配

> **本 plan 完成时**新增一条 "merge 验收清单" 进 CLAUDE.md，把上面 5 类检查写成下一次 merge 后必跑项。

---

## 2. 决策摘要

| 议题 | 方案 | 关键影响 |
|---|---|---|
| env 校验 | 新增 `apps/web/server/env.ts`，zod schema 在模块加载时跑一次；任何 server bundle 第一次 import 即触发；缺关键 env 或长度/组合错误 → 进程 `throw`，Next.js 立刻报 500（而非静默退化） | C1/C2 一锅端；上线漏配立刻可见 |
| Mock 开关语义 | `*_USE_MOCK==="true"` 是 **唯一**进入 mock 的路径；不再用 "key 缺失" 暗中切 mock；env validator 校验"非 mock 时关键配置必须齐" | C2 根治；prod 配错 = boot fail |
| WeChat callback path | 改 `build.ts:13` 的 `${appUrl}/auth/wechat/callback` → `${appUrl}/wechat/callback`，与实际路由对齐；放弃移动路由（route group `(auth)` 保留作 layout 分组用途，URL 是约定俗成的 `/wechat/callback`） | C3 一行改完，e2e 已经在用这个 URL，零回归风险 |
| refresh 原子化 | predicate-on-update 模式：`updateMany({where:{refreshTokenHash, revokedAt: null, expiresAt:{gt:now}}, data:{revokedAt:..., revokedReason:ROTATED}})`，`count===1` 才进新建分支；`count===0` 时再查一次 row 判定 NO_SESSION / REUSE_DETECTED / EXPIRED；整段进 `$transaction`，Postgres row-level lock 保证只一条赢 | I1；不引入显式 advisory lock，Prisma 原生表达 |
| OTP 原子化 | 同 predicate-on-update：`updateMany({where:{id, consumedAt:null, expiredAt:null}, data:{consumedAt:..., attempts:{increment:1}}})` 一次性 claim + 计数；hash 比对放在 claim 前（错码不该消费 OTP）；MAX_ATTEMPTS 边界写在 attempts 增量之后再 `update expiredAt` | I2；与 §2 行为对齐：mismatch 累计 attempts，命中即 consume |
| session-revoke 即时生效 | context 在 `verifyAccess` 之后多一步 **DB 查询**：`prisma.session.findUnique({where:{id:claims.sessionId}})`，若 `revokedAt != null` 或 row 不存在 → 401 `SESSION_REVOKED`；revoke 路径（logout / reuse_detected / admin / rotate）只写 DB `Session.revokedAt`（既有实现已经在写）；context 是这条信息的**唯一**真理来源，每个 authed 请求 +1 indexed lookup | I3；Plan 2 MVP 阶段不引入 Redis 缓存层（避免 fail-mode 决策；DB 是单一真理）。**未来优化**：可在 context 加一层 Redis cache，但必须 cache-miss/error → fall back to DB query；不允许"miss = active" |
| bind callback 身份重校验 | callback 进入 bind 分支前，再读一次 access JWT cookie，`verifyAccess` 必须 ok 且 `claims.userId === meta.userId`；不等的话 redirect `/profile?bind=identity_mismatch`；JWT 缺失则 redirect `/login?next=/profile&bind=identity_required`。**两条路径都只清 `COOKIE_WX_STATE`，不动 access / refresh cookies**（用户的登录态本身合法，只是不能完成 bind） | I4；JWT 已经在场（同源浏览器），不增加额外 round-trip |
| 限频接入 | `auth.register` mutation 在事务前 `takeRule(RULE_REGISTER_IP, ctx.ip)`；`/api/auth/refresh` 在 cookie 读后 `takeRule(RULE_REFRESH, ipFromReq)`，**key 用 IP，不用 token hash**——refresh token 单次轮换，token-hash 永远打不到同一个桶；IP-based 才是抗"同源大量 refresh 滥用"的有意义维度 | G1 |
| 测试矩阵 | §5；要点：每个 race 至少一条 `Promise.all([fn(), fn()])` + 断言"只一条成功 + 没有重复副作用" | G2-G5 |
| 仓库卫生 | `.gitignore` 加 `.claude/worktrees/` 和 `.claire/`；删除 worktree 残留 `.claude/worktrees/plan-2-real-auth/`；CLAUDE.md 加 "merge 后清理 worktree" 章节 | H1 |

### 2.1 显式不做的决策（与对应原因）

| 不做 | 原因 |
|---|---|
| CSRF double-submit token | Plan 2 spec §1.2 已论证：tRPC 都是 JSON POST，浏览器 SOP + SameSite=Lax + refresh 走窄路径 Path=/api/auth 已足够；上 CSRF token 会破坏 tRPC 端到端类型 |
| 把 access JWT TTL 缩到 5 分钟 | 与 I3 重复且更暴力；I3 的 "每请求查 DB Session.revokedAt" 已经把"revoke 即时生效"做到了 |
| 全表用 advisory lock | Prisma 不原生支持，需要 raw SQL；predicate-on-update 已足够，不引入额外复杂度 |
| 把 `(auth)` route group 拆掉，路径改 `/auth/wechat/callback` | `(auth)` group 在用作 layout / route protection 入口；改 URL 涉及更多调用点，性价比低 |

---

## 3. 详细设计

### 3.1 C1：env 启动时校验

**新文件** `apps/web/server/env.ts`：

```ts
import "server-only";
import { z } from "zod";

const Env = z
  .object({
    // 基础设施
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),

    // 鉴权（Critical：不允许默认值）
    ACCESS_JWT_SECRET: z.string().min(32, "ACCESS_JWT_SECRET must be >= 32 bytes"),
    OTP_PEPPER: z.string().min(16, "OTP_PEPPER must be >= 16 bytes"),

    // Mock 开关（"true" 是唯一进入 mock 的路径）
    AI_USE_MOCK: z.enum(["true", "false"]).default("false"),
    SMS_USE_MOCK: z.enum(["true", "false"]).default("false"),
    WECHAT_OAUTH_USE_MOCK: z.enum(["true", "false"]).default("false"),

    // 真接才需要（refine 处校验）
    DASHSCOPE_API_KEY: z.string().optional(),
    DASHSCOPE_BASE_URL: z.string().url().optional(),
    ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
    ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
    ALIYUN_SMS_SIGN_NAME: z.string().optional(),
    ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
    WECHAT_H5_APPID: z.string().optional(),
    WECHAT_H5_SECRET: z.string().optional(),

    // E2E 钩子（仅测试）
    E2E_TEST_HOOKS: z.enum(["0", "1"]).default("0"),
  })
  .refine((e) => e.AI_USE_MOCK === "true" || (e.DASHSCOPE_API_KEY && e.DASHSCOPE_BASE_URL),
    "Real AI requires DASHSCOPE_API_KEY + DASHSCOPE_BASE_URL")
  .refine((e) => e.SMS_USE_MOCK === "true" || (
    e.ALIYUN_SMS_ACCESS_KEY_ID && e.ALIYUN_SMS_ACCESS_KEY_SECRET &&
    e.ALIYUN_SMS_SIGN_NAME && e.ALIYUN_SMS_TEMPLATE_CODE
  ), "Real SMS requires ALIYUN_SMS_* (id/secret/sign/template)")
  .refine((e) => e.WECHAT_OAUTH_USE_MOCK === "true" || (e.WECHAT_H5_APPID && e.WECHAT_H5_SECRET),
    "Real WeChat OAuth requires WECHAT_H5_APPID + WECHAT_H5_SECRET");

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] invalid environment:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  throw new Error("Invalid environment configuration; see above.");
}

export const env = parsed.data;
```

**替换点**（grep `process.env.ACCESS_JWT_SECRET`、`process.env.OTP_PEPPER` 等）：
- `apps/web/server/auth-service.ts:32` → `env.ACCESS_JWT_SECRET`
- `apps/web/server/context.ts:40` → `env.ACCESS_JWT_SECRET`
- `apps/web/app/api/auth/refresh/route.ts:25` → `env.ACCESS_JWT_SECRET`
- `apps/web/app/(auth)/wechat/start/route.ts:17` → `env.ACCESS_JWT_SECRET`
- `apps/web/server/routers/auth.ts:50` 等 OTP_PEPPER 引用同样改

**测试** `apps/web/tests/integration/env-validation.test.ts`：
- 缺 ACCESS_JWT_SECRET → import 抛
- ACCESS_JWT_SECRET 长度 < 32 → 抛
- SMS_USE_MOCK=false 而 ALIYUN_SMS_* 缺 → 抛
- WECHAT_OAUTH_USE_MOCK=false 而 WECHAT_H5_APPID 缺 → 抛
- 全部 USE_MOCK=true → 通过

> 关键：env 校验在 **import time** 发生（不是首次请求时），这样 Next.js dev server 启动阶段就报红。如果不希望 dev 启动也卡（比如新人 clone 后第一次 setup），可以让 `Env.safeParse` 在 `NODE_ENV==="test"` 跳过整组 refine。本 spec 默认 **不跳过**——dev 也得有完整 env，否则容易"我本地能跑、prod 起不来"。`.env.example` 给安全默认值（详见 §3.10）。

### 3.2 C2：WeChat / SMS / AI Mock 兜底消除

**同样的反模式**至少出现在三处：
- `packages/integrations/src/wechat/h5-oauth/build.ts:6`（`|| !env.WECHAT_H5_APPID`）
- `apps/web/lib/ai-client.ts:6`（`|| !process.env.DASHSCOPE_API_KEY`）
- `packages/integrations/src/sms/build.ts`（如有；mock 自动兜底，规约同上）

三处一并修，规约一致：**`*_USE_MOCK === "true"` 是进入 mock 的唯一开关；非 mock 时关键配置缺则 throw**。

**改** `packages/integrations/src/wechat/h5-oauth/build.ts`：

```ts
import { MockWechatH5Adapter } from "./mock.js";
import { RealWechatH5Adapter } from "./real.js";
import type { WechatH5Adapter } from "./types.js";

export function buildWechatH5Adapter(env: NodeJS.ProcessEnv): WechatH5Adapter {
  if (env.WECHAT_OAUTH_USE_MOCK === "true") {
    // mock 路径下允许使用占位 appId（仅供 mock identity 写入）
    return new MockWechatH5Adapter(env.WECHAT_H5_APPID || "wx-mock-app");
  }
  // 非 mock：env validator 已保证 APPID/SECRET 齐；这里再强校验一次以兼容直接 import 此函数的场景
  if (!env.WECHAT_H5_APPID || !env.WECHAT_H5_SECRET) {
    throw new Error("buildWechatH5Adapter: real mode requires WECHAT_H5_APPID + WECHAT_H5_SECRET");
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new RealWechatH5Adapter({
    appId: env.WECHAT_H5_APPID,
    secret: env.WECHAT_H5_SECRET,
    redirectUri: `${appUrl}/wechat/callback`, // C3 修复
  });
}
```

**改** `packages/integrations/src/sms/build.ts`（如已有）—— 同样的二选一规约：mock 开关或真接配置二选一，不允许"未设 mock 又没配真接 = 静默 mock"。

**测试** `packages/integrations/tests/wechat-build.test.ts`（新建）：
- `WECHAT_OAUTH_USE_MOCK=true`, APPID 缺 → 返 Mock（appId="wx-mock-app"）
- `WECHAT_OAUTH_USE_MOCK=true`, APPID 设 → 返 Mock（appId=env）
- `WECHAT_OAUTH_USE_MOCK=false`, APPID/SECRET 齐 → 返 Real
- `WECHAT_OAUTH_USE_MOCK=false`, APPID 或 SECRET 缺任一 → 抛
- 现存 `wechat-real.test.ts`、`wechat-mock.test.ts` 不动

### 3.3 C3：WeChat callback path 对账

单点修改 `build.ts:13` `${appUrl}/auth/wechat/callback` → `${appUrl}/wechat/callback`。

**回归保障**：
- 现有 e2e `auth-wechat.spec.ts` 已经命中 `/wechat/callback`，会自然兜底
- 新增 unit test：`buildWechatH5Adapter(real config).buildAuthorizeUrl({state:"x", scope:"snsapi_userinfo"})` 的返回值含 `redirect_uri=...%2Fwechat%2Fcallback`（URL-encoded）

### 3.4 I1：refresh 轮换原子化

**替换** `packages/auth/src/session.ts` 的 `rotateSession`：

```ts
export async function rotateSession(prisma: PrismaClient, refreshToken: string, meta: DeviceMeta) {
  const hash = hashRefresh(refreshToken);

  return prisma.$transaction(async (tx) => {
    // 1. 原子尝试 revoke 当前 session（predicate-on-update）
    const claimed = await tx.session.updateMany({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.ROTATED },
    });

    if (claimed.count !== 1) {
      // 没抢到 → 区分四种状态
      const cur = await tx.session.findUnique({ where: { refreshTokenHash: hash } });
      if (!cur) throw new AuthError("NO_SESSION");

      if (cur.expiresAt <= new Date() && cur.revokedAt == null) {
        // 未来某天理论上不可达（claim 已经把 expired 排除），保留兜底
        throw new AuthError("SESSION_REVOKED");
      }
      if (cur.revokedReason === SessionRevokeReason.ROTATED) {
        // 并发被另一条赢走 → 视作重放
        await tx.session.updateMany({
          where: { userId: cur.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.REUSE_DETECTED },
        });
        throw new AuthError("REUSE_DETECTED");
      }
      // 其它 revoked 原因（USER_LOGOUT / ADMIN_REVOKED / REUSE_DETECTED / EXPIRED）
      throw new AuthError("REUSE_DETECTED"); // 或细分；本 spec 统一作 REUSE_DETECTED
    }

    // 2. 拿到独占权 → 创建新 session
    const cur = await tx.session.findFirst({
      where: { refreshTokenHash: hash, revokedReason: SessionRevokeReason.ROTATED },
      orderBy: { revokedAt: "desc" },
    });
    if (!cur) throw new Error("rotateSession: claimed but cannot refetch (impossible)");

    const newRefresh = randomBytes(32).toString("base64url");
    const next = await tx.session.create({
      data: {
        userId: cur.userId,
        refreshTokenHash: hashRefresh(newRefresh),
        ipCreated: meta.ipCreated ?? null,
        userAgent: meta.userAgent ?? null,
        deviceLabel: meta.deviceLabel ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { sessionId: next.id, userId: cur.userId, refreshToken: newRefresh };
  });
}
```

**关键变化**：
- `findUnique` 不再在 transaction 外
- 旧版的"占位 hash 然后立即覆盖"两步写改成一步 `create with real hash`，因为新 token 在 transaction 内一次生成
- "并发抢同一 refresh token"：第一条 `updateMany` 通过 Postgres 行级锁，**只有一条 count===1**；其他都得 count===0 → 走 REUSE_DETECTED 路径，把该用户其余 session 一并 revoke（与 Plan 2 spec §5 重放检测语义一致）

**测试**：`packages/auth/tests/session-race.test.ts`（新增）
- `createSession` 拿到 rt
- `Promise.all([rotateSession(rt), rotateSession(rt)])`
- 断言：恰好一条 resolves，另一条 rejects `REUSE_DETECTED`
- 断言 DB：该 user 共有 N 条 session 其中 revokedAt=null 的恰好 0 条（因为重放检测把新建那一条也一并 revoke——是的，与 Plan 2 spec 一致，这是 fail-safe）

> **行为细节**：旧 token 并发到达时，两条都走 REUSE_DETECTED → 该 user 所有 session 全 revoke → 用户必须重新登录。这是 Plan 2 spec §5 既定行为；本 plan 不改它，只是把"现在根本检测不到并发"修成"现在能检测到了"。

### 3.5 I2：OTP 校验原子化

**替换** `packages/auth/src/otp.ts` 的 `verifyOtp`：

```ts
export async function verifyOtp(
  prisma: PrismaClient, phone: string, code: string, pepper: string,
): Promise<{ otpId: string }> {
  // 1. 找到最近一条未消费、未失效、未过期的 OTP
  const row = await prisma.otpRequest.findFirst({
    where: { phone, consumedAt: null, expiredAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new AuthError("OTP_EXPIRED");

  // 2. hash 比对（不消费 OTP，只判断是否需要计数 mismatch）
  const expected = hashCode(code, phone, pepper);

  if (expected !== row.codeHash) {
    // mismatch：仅累计 attempts；触发上限就 expiredAt
    const after = await prisma.otpRequest.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (after.attempts >= MAX_ATTEMPTS) {
      await prisma.otpRequest.update({
        where: { id: row.id },
        data: { expiredAt: new Date() },
      });
      throw new AuthError("OTP_MAX_ATTEMPTS");
    }
    throw new AuthError("OTP_INVALID", { remaining: MAX_ATTEMPTS - after.attempts });
  }

  // 3. hash 命中 → 原子 claim
  const claimed = await prisma.otpRequest.updateMany({
    where: { id: row.id, consumedAt: null, expiredAt: null },
    data: { consumedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    // 并发：另一条已经消费过了
    throw new AuthError("OTP_INVALID", { remaining: 0 });
  }
  return { otpId: row.id };
}
```

**关键变化**：
- mismatch 路径与 hit 路径分离；hit 路径用 `updateMany(predicate=consumedAt:null)` 原子 claim
- attempts 自增的并发计数偏差是良性的（最差少算 1）；安全语义靠 claim 的原子性兜底
- 顺序变化：旧版"先 increment attempts 再比 hash"；新版"先比 hash 再决定怎么走"，避免"错码也消耗一次 hit 的机会"——其实旧版也只在 mismatch 才会因 attempts 过 5 而 expire，但顺序更清楚

**测试**：`packages/auth/tests/otp-race.test.ts`（新增）
- `issueOtp` 拿到 code
- `Promise.all([verifyOtp(code), verifyOtp(code)])`
- 断言：恰好一条 resolves，另一条 rejects `OTP_INVALID`
- 断言 DB：该 row consumedAt 不为 null 且只被 consume 一次

补充边界测试 `packages/auth/tests/otp-boundary.test.ts`（新增）：
- 6 次错码 → 第 5 次抛 `OTP_MAX_ATTEMPTS` + `expiredAt` 已设；第 6 次抛 `OTP_EXPIRED`
- 已 consumed 的 row 再 verify → `OTP_EXPIRED`（因为 findFirst 过滤掉了）
- 跨 phone 串验证：phone A 的 OTP 用 phone B 校验 → `OTP_EXPIRED`
- 过期未消费的 row → `OTP_EXPIRED`

### 3.6 I3：会话吊销即时生效（**DB 是唯一真理**）

**改** `apps/web/server/context.ts`：

```ts
export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions): Promise<Ctx> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const at = cookies[COOKIE_AT];
  let auth: AccessClaims | null = null;
  let authError: AuthError | null = null;

  if (!at) {
    authError = "NO_SESSION";
  } else {
    const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
    if (!v.ok) {
      authError = v.reason;
    } else {
      // 新增：DB 查 Session 是否还有效（每个 authed 请求 +1 indexed lookup）
      const sess = await prisma.session.findUnique({
        where: { id: v.claims.sessionId },
        select: { revokedAt: true, expiresAt: true },
      });
      if (!sess || sess.revokedAt != null || sess.expiresAt <= new Date()) {
        authError = "SESSION_REVOKED";
      } else {
        auth = v.claims;
      }
    }
  }
  // ... unchanged
}
```

**revoke 写入侧不需要改**——Plan 2 已经在 `packages/auth/src/session.ts` 的 `revokeSession` / `revokeByRefreshToken` / `rotateSession` 各分支写 `Session.revokedAt`。context 直接读 DB 真理即可。

**`AuthError` 枚举扩展**：`apps/web/server/context.ts` 的 `AuthError` 类型加 `"SESSION_REVOKED"`。tRPC 错误 cause 同名 reason。客户端 refresh-on-401 行为：`SESSION_REVOKED` 不触发 refresh（refresh 本身也会被 rotate 检测拦掉），直接清 cookie + redirect /login。

**性能 / 复杂度取舍**：
- 每个 authed 请求多 1 次 `Session` 表 indexed lookup（PK 唯一查询，亚毫秒级）。MVP 阶段（低 QPS）完全可承受。
- **不引入 Redis 缓存层**。理由：缓存一旦引入，必须处理 cache miss / Redis 挂的 fail-mode；fail-open 会让"DB 真理 + 缓存抖动"窗口里旧 token 仍可用，与"revoke 即时生效"语义直接冲突（这是 2026-05-20 review 否决的方案）。
- 未来需要优化时，可加 cache，但合约必须是：**cache miss/error → fall back to DB query**（Redis 不当真理），且不允许把"miss = active"写成验收行为。

**测试**：`apps/web/tests/integration/session-revoke-immediate.test.ts`（新增）
- 用户 login 拿到 access JWT
- 同一 access JWT 调一个 authed procedure（例 `auth.me`）→ 200
- 调 logout（写 `Session.revokedAt`）
- 用同一 access JWT 再调 `auth.me` → 401，`shape.data.reason === "SESSION_REVOKED"`
- 直接 `prisma.session.update({revokedAt: now, revokedReason: ADMIN_REVOKED})` 触发 admin 路径，同样断言旧 JWT 立刻失效
- 没有 "Redis 丢了旧 token 可用" 这条 case（因为根本不走 Redis）

### 3.7 I4：bind callback 重新校验 access JWT

**改** `apps/web/app/(auth)/wechat/callback/route.ts` bind 分支：

```ts
// bind 分支
if (meta.mode === "bind") {
  if (!meta.userId) return redirectWithClear(new URL("/profile?bind=state_lost", url));

  // 新增：重新校验当前 access JWT，必须存在且 userId 匹配
  const at = cookies[COOKIE_AT];
  if (!at) {
    return redirectWithClear(new URL("/login?next=/profile&bind=identity_required", url));
  }
  const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
  if (!v.ok || v.claims.userId !== meta.userId) {
    return redirectWithClear(new URL("/profile?bind=identity_mismatch", url));
  }

  const outcome = await bindWechatToUser({ /* unchanged */ });
  // ...
}
```

**理由**：state 是 server-side Redis 写的，理论上不可被构造。但：
- 写 state 时校验过用户 X 的 JWT
- callback 时用户可能已经切换账号（同设备多账号）/ access cookie 被擦了 / 浏览器扩展或恶意 page 让 callback 在他人浏览器触发
- 重校验 access JWT 把"绑定时的身份"钉到"callback 时仍是这个身份"，零额外往返

> **Cookie 清理范围**：`redirectWithClear` 既有实现（`route.ts:58`）只清 `COOKIE_WX_STATE`，**不动** `COOKIE_AT` / `COOKIE_RT`。identity_required / identity_mismatch 两条新增分支共用同一个 helper，因此都只清 wx state——用户当前登录态本身合法，只是不能完成 bind，不应该被强制登出。

**测试**：`apps/web/tests/integration/auth-wechat-bind.test.ts`（新增）
- 用户 A 起 bind flow，state.userId=A
- 模拟 cookie 被换成用户 B 的 JWT → callback → 302 to `/profile?bind=identity_mismatch`，无 AuthIdentity 写入
- 用户 A 的 JWT 仍在 → callback → 302 to `/profile?bind=ok`，AuthIdentity 写入
- 无 JWT → 302 to `/login?next=/profile&bind=identity_required`

### 3.8 G1：register / refresh 限频接入

**改** `apps/web/server/routers/auth.ts` `register` mutation：

```ts
register: publicProcedure
  .input(RegisterInput)
  .mutation(async ({ ctx, input }) => {
    const store = ratelimitStore(ctx.redis);
    try {
      const r = await takeRule(store, RULE_REGISTER_IP, ctx.ip);
      if (!r.allowed) toTRPCError("REGISTER_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r.retryAfterMs });
    } catch (e) {
      if (e instanceof RateLimitBackendDownError) toTRPCError("RATELIMIT_BACKEND_DOWN", "INTERNAL_SERVER_ERROR");
      throw e;
    }
    // ... rest unchanged
  }),
```

**改** `apps/web/app/api/auth/refresh/route.ts`：

```ts
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const cookies = parseCookies(req.headers.get("cookie"));
  const rt = cookies[COOKIE_RT];

  // 限频先于 cookie 校验：抗"同源大量 refresh 滥用"，无论 token 是否合法
  const store = new RedisRateLimitStore(redis);
  try {
    const r = await takeRule(store, RULE_REFRESH, ip);
    if (!r.allowed) return new NextResponse(JSON.stringify({ ok: false, reason: "REFRESH_TOO_FREQUENT" }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } });
  } catch (e) {
    if (e instanceof RateLimitBackendDownError) {
      return new NextResponse(JSON.stringify({ ok: false, reason: "RATELIMIT_BACKEND_DOWN" }), { status: 500 });
    }
    throw e;
  }

  if (!rt) return json401("NO_SESSION");
  // ... rest unchanged
}
```

> **为什么 key 用 IP 不用 token hash**：refresh token 单次轮换（rotate 一次就废），同 token 自然不会被合法地用第二次；用 `hashRefresh(rt)` 当 key，每次轮换后 key 都换，永远打不满桶。IP-based 才是抗"同源大量 refresh 滥用"的有意义维度。同 NAT 下同一公网 IP 多用户共享桶在 MVP 阶段可接受（容量 6/min 远高于正常用户的 refresh 频率 ≈ 4/h）。

> **fail mode**：spec §1.2 `RULE_REFRESH = { failMode: "open" }`，spec §1.2 `RULE_REGISTER_IP = { failMode: "open" }`。Plan 2 spec §5 已经讨论过：fail-open 让 Redis 挂时不踩用户脚（注册和 refresh 是核心可用性路径）。

**测试**：
- `apps/web/tests/integration/auth-register-ratelimit.test.ts`（新增）：同 IP 第 6 次 register（哪怕 nonce / payload 都构造好）返 `TOO_MANY_REQUESTS`
- `apps/web/tests/integration/auth-refresh-ratelimit.test.ts`（新增）：同 IP 7 次 POST `/api/auth/refresh`（即使每次都带不同 / 不合法的 token；限频在 cookie 校验前触发）→ 第 7 次返 429。**注意**：测试用 fake token 是有意为之——refresh token 单次轮换后立即作废，无法在测试里反复发同 token 来打桶；用 fake token 同时验证了"限频闸门在 token 校验之前"

### 3.9 覆盖缺口测试矩阵（汇总）

| 测试文件（新增） | 覆盖目标 | 关键断言 |
|---|---|---|
| `packages/auth/tests/session-race.test.ts` | I1 race | concurrent rotate → 至少一条 REUSE_DETECTED，user 所有 active session = 0 |
| `packages/auth/tests/otp-race.test.ts` | I2 race | concurrent verify same code → exactly one success |
| `packages/auth/tests/otp-boundary.test.ts` | OTP 边界 (G4) | MAX_ATTEMPTS / consumed-replay / cross-phone / expired |
| `apps/web/tests/integration/env-validation.test.ts` | C1/C2 | 关键 env 缺/弱 → import 抛 |
| `apps/web/tests/integration/session-revoke-immediate.test.ts` | I3 | logout 后旧 JWT 立刻 401 |
| `apps/web/tests/integration/auth-wechat-bind.test.ts` | I4 | identity_mismatch / identity_required / ok 三分支 |
| `apps/web/tests/integration/auth-register-ratelimit.test.ts` | G1 | 接入 RULE_REGISTER_IP |
| `apps/web/tests/integration/auth-refresh-ratelimit.test.ts` | G1 | 接入 RULE_REFRESH |
| `apps/web/tests/integration/middleware-guard.test.ts` | G2 | unauth 访问 `/profile`、`/error-book`、`/teacher`、`/parent`、`/admin` → 302 `/login?next=...`；带 cookie `__Host-zj_at=<anything>` → pass through；`/tutor`、`/`、`/login` 不在 matcher → middleware 不动它（用 `apps/web/middleware.ts` 既有 matcher 校对） |
| `packages/integrations/tests/wechat-build.test.ts` | C2 build 决策 | mock/real 两条 path + 漏 env 抛错 |

### 3.10 H1：仓库卫生

**改** `.gitignore`：

```
# Local tool worktree caches (Claude Code / Claire)
.claude/worktrees/
.claire/
```

**清残留**（PowerShell，主 repo 下）：

```powershell
git worktree list  # 看 git 还认不认 plan-2-real-auth
git worktree remove .claude/worktrees/plan-2-real-auth  # git 认就走这条
git worktree prune -v                                    # git 不认但 metadata 残留就走这条
Remove-Item -Recurse -Force -LiteralPath .claude/worktrees/plan-2-real-auth  # 仅在 git worktree list 不再列它、且确认不是当前 worktree 后执行
# .claire/worktrees/ 当前是空的；.claire/ 整个进 ignore 后无所谓
```

**改** `CLAUDE.md` 新增 "Merge 验收清单"：

```markdown
### Merge 后必跑（不是绿测试就行）
1. `git status --short --branch` 干净（无 `??`）；若有 `.claude/worktrees/<old-plan>/` 残留 → 先 `git worktree list` 看 git 是否还认它：认就 `git worktree remove`（必要时 `git worktree prune`）；不认则 PowerShell `Remove-Item -Recurse -Force -LiteralPath` 物理删（确认不是当前 worktree 之后）
2. `pnpm.cmd exec turbo typecheck --force`（不走 cache）
3. `pnpm.cmd exec turbo test --force`（不走 cache）
4. E2E：`pnpm.cmd --filter @zhijiao/web test:e2e`（单独跑，不与 typecheck/test 并发）
5. env 探针：把 `.env.local` 临时改名再 `pnpm.cmd --filter @zhijiao/web dev`，期望进程立刻 throw（验证 fail-close）
6. 路由契约：grep `apps/web/app/**/route.ts` 与 `packages/integrations/src/**/build.ts` 里写的 callback URL 对账
7. revoke 语义：手动 logout 后用旧 access JWT 调一个 authed tRPC endpoint（例 `auth.me`），期望 401 `SESSION_REVOKED`；不要测 `/tutor`，它不在 middleware 保护范围
8. PowerShell 调用约定：execution policy 拦 `.ps1`，所有命令一律 `pnpm.cmd`（不是 `pnpm`）
```

---

## 4. 数据模型 delta

**无新表 / 新列**。本 plan 全部是应用层逻辑 + env 校验 + 基于既有 `Session.revokedAt` 列的 DB 真理查询。

理由：
- I1/I2 用 predicate-on-update + Prisma transaction 已经能表达原子性；不需要 `version` 列
- I3 复用既有 `Session.revokedAt` / `Session.expiresAt` 列；每个 authed 请求在 context 做一次 PK indexed lookup；不引入新表、不引入 Redis 黑名单层
- C1/C2 是启动期校验，没有持久化

如果未来 Plan 想做 "session 版本" / "受信设备列表" 等更细的吊销粒度，再加列；本 plan 不预先动手。

---

## 5. 测试矩阵汇总

§3.9 详列。最低标准：
- 每条 Critical / Important 至少一条 integration 测试覆盖修复后的行为
- 每条 race（I1/I2）必须有 `Promise.all` 的并发断言（如 vitest 的 `expect.toHaveBeenCalledTimes` 不够，要去 DB 断言副作用次数）
- env 校验测试不应该污染其它测试（用 `vi.resetModules()` + `vi.stubEnv`）

---

## 6. 不在范围

| 不做 | 理由 / 推迟到 |
|---|---|
| Credit 计费 | Plan 3 |
| 举一反三 / 错因 | Plan 4 |
| 真接 SMS / WeChat 公众号 | Plan 5（必须在本 plan 后） |
| 账户合并工具 / 手机号变更 | 未来 plan |
| 设备管理 UI | 未来 plan |
| 设备指纹 / 风控 | 未来 plan |
| CSRF double-submit token | 当前 SameSite + 窄路径 Path=/api/auth 足够；触发条件未到 |
| apps/admin | 未来 plan |

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| env 校验在 import time 报错让 dev 启动卡 | `.env.example` 改完后 `pnpm setup` 仍然能直接起；新人 onboarding 文档同步说明 |
| 每请求多 1 次 DB session lookup 增加 p99 延迟 | PK 唯一查询 + `select revokedAt, expiresAt`，亚毫秒；MVP 流量 << Postgres 容量；未来如需优化加 Redis cache，但 miss/error 必须 fall back DB（**不允许"miss = active"**） |
| predicate-on-update 在 Postgres `Read Committed` 隔离级下行为 | 行级锁就在 `UPDATE` 那一刻持有；并发更新同行 → 后到者 `WHERE` 在锁等到前者提交后重新评估，自然 count==0；这是 Postgres 标准行为，不需切 Serializable |
| 测试基础设施变化（race 测试需要真 DB + 真 Redis） | testcontainers 已经在用；本 plan 的 race tests 跟随 `pnpm test`（integration 那层），不动 unit 层 |
| env validator 在 import time 抛错让现有 web 测试 / E2E 炸 | Task 1 必须同步修：`apps/web/tests/setup.ts` 加齐 secret/pepper/mock flags；`apps/web/e2e/global-setup.ts:76` 的 `OTP_PEPPER: "e2e-pepper"`（10 字节）必须改成 ≥ 16 字节；任何继续依赖 `process.env.X ?? ""` 的兜底点（如 `apps/web/lib/ai-client.ts:6`）必须一并改造 |

---

## 8. 已确认的决策（2026-05-20 review）

1. **env 校验在 test 模式不跳过 refine**——Task 1 同步修 `apps/web/tests/setup.ts` 加齐 mock flags + secret + pepper；同步修 `apps/web/e2e/global-setup.ts:76` 的 `OTP_PEPPER` 长度（10 → 16+）。
2. **I3 不引入 Redis 黑名单层**——context 直接查 DB `Session.revokedAt`，DB 是唯一真理。未来加 cache 优化时，miss/error 必须 fall back DB。
3. **WeChat callback path 改 `build.ts:13` 一行**，统一到 `/wechat/callback`（不动路由）。
4. **bind 身份错位 / 缺失**两条分支都用 `redirectWithClear` helper：只清 `COOKIE_WX_STATE`，不清 access / refresh cookies。用户登录态本身合法，仅是不能 bind。
5. **CLAUDE.md "Merge 验收清单" 在本 plan 的 Task 9 一并落地**（§3.10）。

---

## 附录 A：审计原文摘要（来自用户 2026-05-20 消息）

- 验证 agent 强制跑 `pnpm.cmd exec turbo typecheck --force`，6/6 packages 成功
- 强制跑 `pnpm.cmd exec turbo test --force` 时 `@zhijiao/ai tests/router.test.ts:132` 失败一次，单包重跑又通过 → 根级并行测试至少不稳定（**本 plan 不直接修这个 flake，但 Merge 验收清单要求 `--force` 跑通才算通过；如果反复 flake，开独立 plan 修 turbo 并发**）
- E2E 验证 agent 单独跑 3/3 通过；并发验证时 `next build` 在 `.next\export\500.html` rename 失败 → 并发构建写 `.next` 冲突（**E2E 不与 typecheck/test 并发跑** 进 Merge 清单）

附录 A 的两条次级稳定性问题（turbo 并发 test flake、e2e 与 build 的 `.next` 写冲突）**不在本 plan 修**，但在 CLAUDE.md Merge 清单里写明"不要并发跑"。

**baseline 立场更新**（2026-05-20 review）：原 plan 写"baseline 假设绿"是错的——同 review 已经记录到至少一次 `pnpm exec turbo test --force` 时 `@zhijiao/ai tests/router.test.ts:132` 失败。本 plan 的 **Task 0-baseline**（plan §"前置"）必须连跑 3 次 `--force` 测试，记录每次结果；如果 flake 复现 → 进入决策点（要么把 flake 修进本 plan、要么单独开 plan）；不允许在没复现 baseline 状态的情况下继续。
