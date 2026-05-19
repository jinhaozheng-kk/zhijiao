---
title: 智教 — 真实鉴权 (Plan 2) 设计 Spec
date: 2026-05-19
status: approved
scope: real-auth (OTP + 微信 H5 OAuth + Session + JWT + tRPC 落地)
audience: 实施者（Claude Code）、用户（产品/架构审核者）
source: 2026-05-19 brainstorming session（本文档附录 A 含 Q&A trace）
supersedes:
  - 2026-05-18-tech-stack-and-project-structure-design.md §4.1–§4.3（鉴权与 RBAC，被本文修订）
---

# 智教 · 真实鉴权（Plan 2）设计

## 0. 文档信息

**目标**：把 Plan 1 落下的硬编码 `DEV_USER_ID` 替换为真实鉴权体系；落地 tRPC；为后续 Plan 3（Credit）/ Plan 4（举一反三）腾出可用的 `ctx.auth.userId`。

**范围**：
- ✅ 包含：手机号 OTP + 微信 H5 OAuth（adapter 接口完整，真接公众号留后续 plan）+ Session/JWT 自建（jose + Prisma）+ tRPC 全量落地（含 askTutor 迁移）+ Redis token-bucket 限频 + 账号绑定 + 注册 persona/学段 + 未成年人字段
- ❌ 不包含：真接阿里云短信生产 / 真接微信公众号 / 开放平台扫码 / 小程序 / Credit 计费（仅占位中间件）/ 账户合并工具 / 家长子女绑定 / 教师认证 / 设备管理 UI / apps/admin

**前置依赖**：
- Plan 1 完成（`docs/superpowers/plans/2026-05-18-foundation-and-tutor-turn.md`）
- 技术栈 spec（`docs/superpowers/specs/2026-05-18-tech-stack-and-project-structure-design.md`）的 §1–§3、§5、§6 仍生效；§4.1–§4.3 由本文修订

---

## 1. 决策摘要

### 1.1 Brainstorming 锁定的决策

| 议题 | 结论 | 关键影响 |
|---|---|---|
| 完成定义 | MVP：OTP / Session / JWT / tRPC 真走；微信 H5 OAuth adapter 完整 + Mock 实现 | 不被 ICP 备案阻塞；Plan 2 可单独 ship 且 E2E 全绿 |
| 鉴权底层路线 | 自建 `jose` + Prisma `Session` 表（不上 Auth.js / Lucia） | 完全贴 spec §4.2；可控；测试可纯函数 |
| Session/Refresh 存储 | 方案 A1：Prisma `Session` 表（事务/审计/设备管理友好） | Redis 仅用于 OTP 限频与 cache；不当真理 |
| 微信骨架方式 | 方案 B1：`WechatH5Adapter` 接口 + `RealWechatH5Adapter`（缺 env 时抛 `NotConfigured`）+ `MockWechatH5Adapter`（dev/test 默认） | 切换只改 env；真接时只新增 Real 实现，不动 callback 路由 |
| 短信通道 | 阿里云短信代码完整 + `MockSmsAdapter`（console.log）+ `TestSmsAdapter`（内存收集供 E2E 读取） | 同上 |
| tRPC 改造范围 | 全量落地；现存 `askTutor` server action 迁到 `tutor.ask` 并删除旧文件 | 一套 auth 入口；下一个 procedure 直接拼上 |
| Persona vs RBAC | **TEACHER 是 persona（默认路由）不是权限门槛**；真正 Role 只剩 `OPS` / `ADMIN`；所有登录用户默认有 `PAPER_GEN / LESSON_PLAN_GEN / PPT_GEN / TUTOR_ASK / ERROR_BOOK_VIEW_OWN` | 修订技术栈 spec §4.3；persona 不进 procedure 中间件 |
| 用户字段扩展 | `User.persona`（STUDENT/TEACHER/PARENT，默认 STUDENT）、`User.gradeLevel`、`User.isMinor`（从 gradeLevel 派生并固化） | 注册流多 1 步选择；未成年人状态面留底 |
| 账号绑定 | 手机号 ↔ 微信合并为同一 User（profile 页主动发起）；冲突时**拒绝自动合并**，提示先解绑 | 完整合并工具留后续 plan |
| 限频 | Redis token bucket；规则表中心化；**OTP 路径 fail-close**，其他入口 fail-open | Redis 挂时不会因短窗口暴力丢账号，但可用性不会全站塌 |

### 1.2 与技术栈 spec §4 的差异（明确替换）

| 技术栈 spec 原文 | 本文修订 |
|---|---|
| §4.1 表格列 "PC 微信开放平台扫码" | Plan 2 不做；adapter 接口预留 `WECHAT_OPEN` provider，实际实现留后续 plan |
| §4.2 "Access JWT 15min + Refresh 30d（轮换）" | 保持不变 |
| §4.2 "Web 端：access token 走 httpOnly cookie + CSRF token" | 修订为：`__Host-zj_at` 走 httpOnly cookie + SameSite=Lax + Path=/；`zj_rt` 走 SameSite=Strict + Path=/api/auth（窄路径，已隐式抵御大部分 CSRF）。**Plan 2 不引入 double-submit CSRF token**——所有 mutation 都走 tRPC POST + JSON，浏览器 SOP + SameSite=Lax 已经够 |
| §4.3 `STUDENT / TEACHER / PARENT / OPS / ADMIN` | 修订为：`Role = OPS \| ADMIN`；`Persona = STUDENT \| TEACHER \| PARENT`（仅作 onboarding 默认路由）；`TEACHER_GEN_PAPER` 拆为 `PAPER_GEN / LESSON_PLAN_GEN / PPT_GEN` 并对所有登录用户开放 |
| §4.3 `authedProcedure(role?)` | 修订为：`authedProcedure`（任何登录用户）+ `permissionProcedure(perm)`（按权限）；不再有"按角色"过滤层 |

---

## 2. 数据模型 delta

### 2.1 User（改）

```prisma
model User {
  id          String      @id @default(cuid())
  // ❌ 删：phone / wechatOpenid / wechatUnionid / email —— 全部搬到 AuthIdentity
  name        String?
  avatarUrl   String?     @map("avatar_url")

  persona     Persona     @default(STUDENT)
  gradeLevel  GradeLevel? @map("grade_level")   // persona=STUDENT 时必填
  isMinor     Boolean     @default(true) @map("is_minor")  // 派生自 gradeLevel，写入时固化

  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt      @map("updated_at")

  roles       UserRole[]
  identities  AuthIdentity[]
  sessions    Session[]
  @@map("users")
}

enum Persona { STUDENT TEACHER PARENT }
```

> **派生规则**（`packages/domain/src/grade.ts`）：
> - `gradeLevel ∈ {G5..G9}` → `isMinor=true`
> - `gradeLevel ∈ {G10..G12}` → `isMinor=false`
> - persona ≠ STUDENT 或 gradeLevel = null → `isMinor=false`
> - 更新 gradeLevel 时同步重算 isMinor（写在 application layer，不用 trigger）

### 2.2 AuthIdentity（新）

```prisma
enum AuthProvider {
  PHONE             // providerUserId = E.164 phone
  WECHAT_H5         // providerUserId = openid；providerScope = 公众号 AppID
  WECHAT_OPEN       // 后续 plan
  WECHAT_MINIAPP    // 后续 plan
}

model AuthIdentity {
  id              String       @id @default(cuid())
  userId          String       @map("user_id")
  provider        AuthProvider

  // 非空，把"哪个外部命名空间"显式化：
  //   PHONE          → 写死常量 "GLOBAL"（手机号本身全局唯一）
  //   WECHAT_H5      → 公众号 AppID（如 "wx1234567890abcdef"）
  //   WECHAT_OPEN    → 开放平台 AppID
  //   WECHAT_MINIAPP → 小程序 AppID
  providerScope   String       @map("provider_scope")

  providerUserId  String       @map("provider_user_id")
  unionId         String?      @map("union_id")  // 仅 WECHAT_*
  metadata        Json?
  createdAt       DateTime     @default(now()) @map("created_at")
  lastUsedAt      DateTime?    @map("last_used_at")

  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerScope, providerUserId], name: "uniq_identity")
  @@index([provider, unionId])
  @@index([userId])
  @@map("auth_identities")
}
```

> **约束理由**：核心唯一键三列全部 NOT NULL（避免 Postgres `null != null` 语义带来的"重复值能写入"陷阱）。
>
> **应用层校验**（`packages/auth/src/identity.ts`）：write 前强制 `providerScope` 非空；PHONE 必须 `"GLOBAL"`；WECHAT_* 必须传 AppID。

### 2.3 Session（新）

```prisma
model Session {
  id                String    @id @default(cuid())
  userId            String    @map("user_id")
  refreshTokenHash  String    @unique @map("refresh_token_hash")  // SHA-256(refreshToken)
  deviceLabel       String?   @map("device_label")
  ipCreated         String?   @map("ip_created")
  userAgent         String?   @map("user_agent")
  createdAt         DateTime  @default(now()) @map("created_at")
  lastUsedAt        DateTime  @default(now()) @map("last_used_at")
  expiresAt         DateTime  @map("expires_at")                  // createdAt + 30d
  revokedAt         DateTime? @map("revoked_at")
  revokedReason     String?   @map("revoked_reason")              // ROTATED / USER_LOGOUT / REUSE_DETECTED / ADMIN_REVOKED

  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([expiresAt])
  @@map("sessions")
}
```

### 2.4 OtpRequest（新）

```prisma
enum OtpPurpose { LOGIN BIND_PHONE }

model OtpRequest {
  id          String     @id @default(cuid())
  phone       String                             // E.164
  purpose     OtpPurpose
  codeHash    String     @map("code_hash")        // SHA-256(code + phone + pepper)
  attempts    Int        @default(0)              // ≥ 5 触发 expiredAt
  ipCreated   String?    @map("ip_created")
  userAgent   String?    @map("user_agent")
  createdAt   DateTime   @default(now()) @map("created_at")
  expiresAt   DateTime   @map("expires_at")       // createdAt + 5min
  consumedAt  DateTime?  @map("consumed_at")
  expiredAt   DateTime?  @map("expired_at")

  @@index([phone, createdAt])
  @@index([expiresAt])
  @@map("otp_requests")
}
```

> **限频不靠这张表**（DB 太慢），靠 Redis（§5）。该表用途：① 验证时对账；② 失败次数计数；③ 事后审计。

### 2.5 RBAC 重构（`packages/domain/src/rbac.ts`）

```ts
export type Role = "OPS" | "ADMIN";

export type Permission =
  | "TUTOR_ASK"
  | "PAPER_GEN" | "LESSON_PLAN_GEN" | "PPT_GEN"
  | "ERROR_BOOK_VIEW_OWN"
  | "OPS_PUBLISH_FORECAST" | "OPS_CURATE_CONTENT" | "OPS_ADJUST_CREDIT"
  | "ADMIN_MANAGE_USERS"   | "ADMIN_MANAGE_MODELS" | "ADMIN_VIEW_AUDIT";

export const DEFAULT_LOGGED_IN_PERMS: Permission[] = [
  "TUTOR_ASK", "PAPER_GEN", "LESSON_PLAN_GEN", "PPT_GEN", "ERROR_BOOK_VIEW_OWN",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OPS:   ["OPS_PUBLISH_FORECAST", "OPS_CURATE_CONTENT", "OPS_ADJUST_CREDIT"],
  ADMIN: ["ADMIN_MANAGE_USERS", "ADMIN_MANAGE_MODELS", "ADMIN_VIEW_AUDIT",
          "OPS_PUBLISH_FORECAST", "OPS_CURATE_CONTENT", "OPS_ADJUST_CREDIT"],
};

export function hasPermission(roles: Role[], perm: Permission): boolean {
  if (DEFAULT_LOGGED_IN_PERMS.includes(perm)) return true;
  return roles.some(r => ROLE_PERMISSIONS[r]?.includes(perm));
}
```

> Plan 1 的 `STUDENT_ASK` 等枚举值全部废弃；migration + seed 同步改。

### 2.6 数据迁移（Plan 1 → Plan 2）

Plan 1 seed 了 5 个用户（`User.phone` 列）。本 plan 的 Prisma migration 需要：
1. 删 `User.phone / wechatOpenid / wechatUnionid / email` 列前，对每行非空 phone 插入对应 `AuthIdentity(provider=PHONE, providerScope="GLOBAL", providerUserId=phone, userId=user.id)`
2. 重写 `1_test_users.ts` seed：新建 User 时一并 create AuthIdentity
3. `dev-ops-01` 给 `UserRole(role=OPS)`、`dev-admin-01` 给 `UserRole(role=ADMIN)`；其余 3 个用户无 Role（默认权限即可）

---

## 3. 认证流程

### 3.1 手机号 OTP 登录

```
[LoginForm]
    │ phone (E.164)
    ▼
POST /api/trpc/auth.otpRequest          (publicProcedure)
    │ ratelimit("otp:send:phone:<phone>")  capacity=1 / refill 1/60s + burst 5/h     [fail-close]
    │ ratelimit("otp:send:ip:<ip>")        capacity=10 / refill 10/60s + 30/h         [fail-close]
    │ 生成 6 位 code；codeHash = sha256(code + phone + pepper)
    │ INSERT OtpRequest{phone, purpose=LOGIN, codeHash, attempts=0, expiresAt=+5m}
    │ adapter.send(phone, code)            // mock: console.log；test: TestSmsAdapter 入内存；real: 阿里云 SMS
    ▼ 200 OK
[OtpForm]
    │ code
    ▼
POST /api/trpc/auth.otpVerify           (publicProcedure)
    │ ratelimit("otp:verify:phone:<phone>") capacity=5 / refill 5/60s                  [fail-close]
    │ SELECT OtpRequest WHERE phone=? AND consumedAt IS NULL AND expiredAt IS NULL
    │   AND expiresAt > now() ORDER BY createdAt DESC LIMIT 1
    │ 无 → OTP_EXPIRED
    │ attempts += 1；命中 → 5 → set expiredAt → OTP_MAX_ATTEMPTS
    │ codeHash 不匹配 → OTP_INVALID
    │ 匹配 → set consumedAt = now()
    │
    │ AuthIdentity.findUnique({provider:PHONE, providerScope:"GLOBAL", providerUserId:phone})
    │   ├─ 命中 → 已注册：调 issueSession(userId)；回 {status:"logged_in", user, defaultRoute}
    │   └─ 未命中 → 未注册：
    │        registerToken = jose.sign({provider:"PHONE", scope:"GLOBAL", providerUserId:phone, purpose:"register"}, REGISTER_SECRET, "10m")
    │        nonce = randomBase64url(16)
    │        redis SET register:<nonce> {tokenHash, used:false} EX 600
    │        Set-Cookie __Host-zj_register_token = <nonce>   (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600)
    │        回 {status:"need_register"}
    ▼
若 need_register：跳 /register
```

### 3.2 微信 H5 OAuth（公众号网页授权）

```
[LoginForm "微信登录" tab]
    │ click
    ▼
GET /auth/wechat/start                  (Node runtime route handler，NOT tRPC)
    │ state = randomBase64url(16)
    │ redis SET wx:state:<state> {mode:"login", csrf:<hash>} EX 300
    │ Set-Cookie __Host-zj_wx_state = <state>       (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300)
    │ adapter.buildAuthorizeUrl({state, scope:"snsapi_userinfo"})
    │ 302 → 微信授权页
    ▼
[微信] 用户同意 → 302 → /auth/wechat/callback?code=XXX&state=YYY
    ▼
GET /auth/wechat/callback               (Node runtime route handler)
    │ 校验 cookie state == URL state；否则 WECHAT_STATE_MISMATCH
    │ redis GETDEL wx:state:<state> → 拿到 {mode, csrf, userId?}；不存在 → WECHAT_STATE_MISMATCH
    │ adapter.exchangeCodeForUser(code) → {openid, unionid?, nickname?, avatarUrl?}
    │   real: 调微信 access_token + userinfo
    │   mock: 按 code 字符串映射伪 openid（test 用 code="mock-new-user"/"mock-existing"/etc 区分场景）
    │   失败 → WECHAT_CODE_INVALID
    │
    │ if mode == "login":
    │     AuthIdentity.findUnique({provider:WECHAT_H5, scope:appId, providerUserId:openid})
    │       ├─ 命中 → issueSession + 302 → defaultRoute
    │       └─ 未命中 →
    │             若 unionid 命中其他 WECHAT_* 行 → 复用其 userId（unionid 合并）+ 写新 Identity + issueSession + 302
    │             否则 → 走 need_register 同套流程：
    │                 registerToken = jose.sign({provider:"WECHAT_H5", scope:appId, providerUserId:openid, unionid, profile, purpose:"register"}, REGISTER_SECRET, "10m")
    │                 Set-Cookie __Host-zj_register_token = <nonce>
    │                 302 → /register?from=wechat
    │
    │ if mode == "bind":  (用户在 profile 页发起绑定)
    │     AuthIdentity.findUnique 命中且 userId == ctx.userId → 已绑过，302 /profile?bind=noop
    │     未命中 → AuthIdentity.create({userId:ctx.userId, ...}) + 302 /profile?bind=ok
    │     命中且 userId != ctx.userId → 302 /profile?bind=conflict（WECHAT_BIND_CONFLICT）
```

> **state 安全**：state 仅是一个 UUID；mode/userId 等敏感数据**只存 Redis**，OAuth 回跳中不暴露。GETDEL 保证一次性消费。

### 3.3 注册（统一两步流）

```
[/register]                              (Server Component 渲染)
    │ 从 cookie 读 __Host-zj_register_token nonce
    │ 调 auth.registerInfo (publicProcedure) 取出 registerToken payload（只读，不消耗）
    │   → 渲染：provider 显示（手机号 vs 微信）+ persona picker + (gradeLevel 在 persona=STUDENT 时显示)
    ▼ 用户填表
POST /api/trpc/auth.register             (publicProcedure)
    │ ratelimit("register:ip:<ip>")  capacity=5 / refill 5/60s                       [fail-open]
    │ 从 cookie 读 nonce → redis GET register:<nonce>
    │   ├─ 不存在 / used:true → REGISTER_TOKEN_MISSING；清 cookie；客户端跳 /login
    │   └─ 存在 → 取出 tokenHash，校对 jose 验签
    │ 验证 token sub 一致 → 不一致 → REGISTER_TOKEN_EXPIRED；清 cookie
    │
    │ 事务：
    │   1. create User{persona, gradeLevel?, isMinor:derive(persona, gradeLevel), name?}
    │   2. create AuthIdentity{userId, provider, providerScope, providerUserId, unionId?, metadata?}
    │   3. issueSession(userId, deviceMeta) → 写 Session 行 + 拿 access/refresh
    │   4. redis SET register:<nonce> {used:true} EX 60  （短期保留防 race）
    │
    │ Set-Cookie 清 __Host-zj_register_token；写 __Host-zj_at + zj_rt
    │ 回 {user, defaultRoute: byPersona(persona)}
```

> **registerToken cookie 清除策略**：
> - ✅ 注册成功 → 清
> - ✅ token 不存在 / 已 used / 已 expire → 清（重试无意义）
> - ❌ 表单校验失败（gradeLevel 缺失等）→ **不清**；用户改完字段重交即可

### 3.4 IssueSession + Cookie

```ts
function issueSession(userId, { ip, ua, deviceLabel }) {
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshTokenHash = sha256(refreshToken);
  const session = await prisma.session.create({
    data: { userId, refreshTokenHash, deviceLabel, ipCreated:ip, userAgent:ua, expiresAt:+30d }
  });
  const access = await jose.sign(
    { sub:userId, sid:session.id, persona:user.persona, roles:user.roles.map(r=>r.role) },
    ACCESS_SECRET, "15m"
  );
  setCookies({
    "__Host-zj_at": { value:access, HttpOnly:true, Secure:true, SameSite:"Lax",    Path:"/",          MaxAge:900 },
    "zj_rt":        { value:refreshToken, HttpOnly:true, Secure:true, SameSite:"Strict", Path:"/api/auth", MaxAge:2592000 },
  });
  return { user, defaultRoute: byPersona(user.persona) };
}
```

> `zj_rt` 不能用 `__Host-` 前缀 —— `__Host-` 强制 `Path=/`，与"refresh 走 /api/auth 窄路径"冲突。改用普通 cookie + `HttpOnly + Secure + SameSite=Strict` 已经够强。
>
> `byPersona`：STUDENT→`/`（暂沿用 landing）、TEACHER→`/teacher`（页面后续 plan 建，本 plan 占位 stub 页）、PARENT→`/parent`（同）。

### 3.5 Refresh

```
POST /api/auth/refresh                   (Node runtime route handler)
    │ 读 zj_rt cookie；缺 → 401 NO_SESSION
    │ ratelimit("refresh:sid:<sid?>")  按 IP 兜底（无 sid 时）；6 / 60s              [fail-open]
    │ hash = sha256(zj_rt)
    │ SELECT Session WHERE refreshTokenHash = hash                                    (不带 revokedAt 过滤！)
    │   ├─ null            → 401 NO_SESSION
    │   ├─ revokedAt != null → ⚠️ 重放检测：
    │   │                     UPDATE Session SET revokedAt=now, revokedReason='REUSE_DETECTED'
    │   │                       WHERE userId = session.userId AND revokedAt IS NULL
    │   │                     清 cookies；401 REUSE_DETECTED
    │   ├─ expiresAt <= now → UPDATE 该行 revokedAt=now, reason='EXPIRED'；401 SESSION_REVOKED
    │   └─ 正常 → 事务：
    │         UPDATE old: revokedAt=now, revokedReason='ROTATED'
    │         INSERT new Session 行 + 新 refresh token
    │         签新 access JWT
    │         Set-Cookie 新 zj_at + zj_rt
    │         200 { expiresIn:900 }
```

### 3.6 Logout

```
POST /api/auth/logout                    (Node runtime route handler)
    │ 读 zj_rt → 找 Session：UPDATE revokedAt=now, revokedReason='USER_LOGOUT'（命中即更新；查不到也无所谓）
    │ 清 zj_at + zj_rt
    │ 200
```

> **必须**走 `/api/auth/logout`（不在 tRPC）—— zj_rt cookie 的 Path=/api/auth，tRPC 请求带不到。

### 3.7 Next middleware（只做轻 route guard）

```ts
// apps/web/middleware.ts
// 不读 DB、不解 JWT —— Edge runtime 友好
export function middleware(req: NextRequest) {
  const hasAt = req.cookies.has("__Host-zj_at");
  const PROTECTED = ["/profile", "/error-book", "/teacher", "/parent", "/admin"];
  if (PROTECTED.some(p => req.nextUrl.pathname.startsWith(p)) && !hasAt) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
}
export const config = {
  matcher: ["/profile/:path*", "/error-book/:path*", "/teacher/:path*", "/parent/:path*", "/admin/:path*"],
};
```

> 真正的强校验在 `authedProcedure`；middleware 只看 cookie 是否存在，是 UX 跳转层。

---

## 4. tRPC context + 三层 procedure

### 4.1 Context

```ts
// apps/web/server/context.ts
type AccessClaims = { userId: string; sessionId: string; persona: Persona; roles: Role[] };
type AuthError   = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION";

export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions) {
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  const at = cookies["__Host-zj_at"];
  let auth: AccessClaims | null = null;
  let authError: AuthError | null = null;

  if (!at) authError = "NO_SESSION";
  else {
    const v = await verifyAccess(at);
    if (v.ok) auth = v.claims; else authError = v.reason;
  }

  return {
    db: prisma,
    redis,
    auth, authError,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    ua: req.headers.get("user-agent") ?? "",
    resHeaders,
  };
}
```

> Access JWT 不查 DB；只有 refresh / 设备管理 / logout 走 `Session` 表。

### 4.2 三层 procedure

```ts
// apps/web/server/trpc.ts
const t = initTRPC.context<Ctx>().create({ transformer: superjson });

export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请先登录",
      cause: { reason: ctx.authError ?? "NO_SESSION" },  // 序列化到 error.data.reason
    });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const permissionProcedure = (perm: Permission) =>
  authedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.auth.roles, perm)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "权限不足", cause: { reason: "PERMISSION_DENIED" } });
    }
    return next();
  });
```

### 4.3 Router 清单

```ts
appRouter = router({
  auth: router({
    otpRequest:      publicProcedure.input(OtpRequestInput).mutation(...),
    otpVerify:       publicProcedure.input(OtpVerifyInput).mutation(...),
    registerInfo:    publicProcedure.query(...),                       // 读 cookie nonce → 还原 token payload（只读、不消耗）
    register:        publicProcedure.input(RegisterInput).mutation(...), // 真正消耗 token、建 User、issueSession
    me:              authedProcedure.query(...),                       // {user, sessions:[Session...]}
    revokeSession:   authedProcedure.input(z.object({sessionId:z.string()})).mutation(...),
  }),
  tutor: router({
    ask: authedProcedure
           .use(creditPlaceholder("TUTOR_ASK"))   // Plan 3 落 Credit；本 plan no-op 占位
           .input(TutoringInputSchema)
           .mutation(async ({ ctx, input }) => {
             const router = getAiRouter(ctx.auth.userId);
             return router.tutor(input);
           }),
  }),
});
```

> 不在 tRPC：`wechat.start` / `wechat.callback` / `refresh` / `logout` —— 全部走 Node route handler。
>
> 旧 `apps/web/app/(student)/tutor/actions.ts` 删除；`apps/web/lib/ai-client.ts` 删 `DEV_USER_ID`，`getAiRouter` 签名收紧到 `getAiRouter(userId: string)`。

### 4.4 客户端 refresh-on-401 拦截器

```ts
// apps/web/lib/trpc-client.ts （httpBatchLink 之上加一层 errorRetryLink）
// 仅满足 error.data?.code === "UNAUTHORIZED" && error.data?.reason === "ACCESS_EXPIRED" 才尝试
// op.context.refreshAttempted 标记防止递归；最多重试 1 次
// SESSION_REVOKED / REUSE_DETECTED / NO_SESSION / ACCESS_INVALID → 不重试，全清 cookies + redirect /login
```

---

## 5. 限频（Redis token bucket）

### 5.1 实现（`packages/auth/src/ratelimit.ts`）

```ts
export interface RateLimitStore {
  take(bucket: string, capacity: number, refillPerSec: number, cost: number, nowMs: number): Promise<{allowed: boolean; retryAfterMs: number}>;
}

// RedisStore: Lua 脚本 EVALSHA 原子 refill+consume
// InMemoryStore: 单元测试用，可注入 fake clock

export async function take(rule: RateLimitRule, keySuffix: string): Promise<{allowed: boolean; retryAfterMs: number}>;
```

### 5.2 规则表（`packages/auth/src/ratelimit-rules.ts`）

| 场景 | key | capacity | refill | fail 行为 | 触发错误 |
|---|---|---|---|---|---|
| OTP 发送（phone） | `otp:send:phone:<phone>` | 1 | 1/60s + burst 5/h | **fail-close** | OTP_SEND_TOO_FREQUENT |
| OTP 发送（IP） | `otp:send:ip:<ip>` | 10 | 10/60s + burst 30/h | **fail-close** | OTP_SEND_TOO_FREQUENT |
| OTP 校验（phone） | `otp:verify:phone:<phone>` | 5 | 5/60s | **fail-close** | OTP_VERIFY_TOO_FREQUENT |
| 注册（IP） | `register:ip:<ip>` | 5 | 5/60s | fail-open | REGISTER_TOO_FREQUENT |
| Refresh（sid 或 IP） | `refresh:<sid或ip>` | 6 | 6/60s | fail-open | （internal log only） |

> **Fail-close 路径**：Redis 不可达 → `take` 抛 `RATELIMIT_BACKEND_DOWN` → procedure 抛 `INTERNAL_SERVER_ERROR + reason:"RATELIMIT_BACKEND_DOWN"`；Sentry 告警。
>
> **Fail-open 路径**：Redis 不可达 → `take` 返回 `{allowed:true}`；Sentry 告警但不阻塞业务。

---

## 6. 错误码、不变量、测试

### 6.1 错误码表

> 所有 code 均为 tRPC 原生支持值（`TRPC_ERROR_CODES_BY_KEY`）。

| reason | code | 用户面文案 | 客户端动作 |
|---|---|---|---|
| ACCESS_EXPIRED | UNAUTHORIZED | （静默） | 调 `/api/auth/refresh` 一次，重放原请求；失败 → /login |
| ACCESS_INVALID | UNAUTHORIZED | "登录状态已失效，请重新登录" | 全清 cookies + redirect /login |
| NO_SESSION | UNAUTHORIZED | "请先登录" | redirect /login?next=... |
| SESSION_REVOKED | UNAUTHORIZED | "登录已被吊销" | 同 ACCESS_INVALID |
| REUSE_DETECTED | UNAUTHORIZED | "检测到异常登录，所有设备已被退出，请重新登录" | 同 ACCESS_INVALID |
| PERMISSION_DENIED | FORBIDDEN | "权限不足" | 原页 toast |
| OTP_SEND_TOO_FREQUENT | TOO_MANY_REQUESTS | "请 ${retryAfter}s 后再试" | 倒计时禁用按钮 |
| OTP_VERIFY_TOO_FREQUENT | TOO_MANY_REQUESTS | "尝试过多，请稍后再试" | 倒计时 |
| OTP_EXPIRED | BAD_REQUEST | "验证码已过期，请重发" | 触发重发流 |
| OTP_INVALID | BAD_REQUEST | "验证码错误（还可尝试 N 次）" | 输入框抖动 |
| OTP_MAX_ATTEMPTS | BAD_REQUEST | "尝试过多，验证码已失效" | 触发重发流 |
| RATELIMIT_BACKEND_DOWN | INTERNAL_SERVER_ERROR | "服务繁忙，请稍后再试" | toast；仅 OTP 路径触发 |
| WECHAT_STATE_MISMATCH | BAD_REQUEST | "登录链路异常，请重试" | redirect /login |
| WECHAT_CODE_INVALID | BAD_REQUEST | "微信授权失败" | redirect /login |
| WECHAT_BIND_CONFLICT | CONFLICT | "该微信已绑定其他账号" | profile 页 toast |
| REGISTER_TOKEN_MISSING | BAD_REQUEST | "注册链路已过期，请重新登录" | redirect /login |
| REGISTER_TOKEN_EXPIRED | BAD_REQUEST | 同上 | 同上 |
| REGISTER_TOO_FREQUENT | TOO_MANY_REQUESTS | "请稍后再试" | toast |
| INSUFFICIENT_CREDITS | FORBIDDEN | （Plan 3 才落） | — |

### 6.2 不变量（系统级）

1. 同一 `(provider, providerScope, providerUserId)` 永远对应至多 1 行 `AuthIdentity`，至多 1 个 User。
2. 同一 User 可有多个 AuthIdentity；删 User → 级联删 Identity 与 Session。
3. Session 一次 rotate = old 行 `revokedAt=now, reason=ROTATED` + 新 INSERT 一行；活跃 session 数不变。
4. 检测到 `revokedAt != null` 的 refresh token 被使用 → 该 User **所有未失效** session 全部 revoke（`reason=REUSE_DETECTED`）。
5. `OtpRequest.attempts >= 5` → `expiredAt = now`，同一手机号必须重发。
6. registerToken 单次有效；注册成功 / token 失效时清 cookie；表单校验失败**不**清 cookie。
7. `__Host-` 前缀的 cookie 必须满足 `Secure + Path=/ + 无 Domain`：
   - `__Host-zj_at`、`__Host-zj_register_token`、`__Host-zj_wx_state`：Path=/
   - `zj_rt`：不能用 `__Host-` 前缀（Path=/api/auth）；通过 `HttpOnly + Secure + SameSite=Strict` 保护
8. Access JWT 永远不查 DB；refresh / logout / session 列表才走 DB。
9. WeChat callback 的 state 是一次性 UUID（GETDEL 消费）；mode / userId 等敏感数据**不**编码进 state，仅存 Redis。

### 6.3 测试分层

| 层 | 位置 | 覆盖 | 备注 |
|---|---|---|---|
| 单元 | `packages/auth/tests` | JWT sign/verify、cookie 序列化、ratelimit token bucket（用 `InMemoryStore`）、OTP 生成与 hash 比对、session rotate/reuse-detect 纯函数 | LLM/SMS/微信全 mock；不起 Postgres/Redis |
| 单元 | `packages/integrations/tests` | `MockSmsAdapter` capture、`MockWechatH5Adapter` 按 code 回放、`RealWechatH5Adapter` 缺 env 时抛 `NotConfigured` | 不打真接口 |
| 集成 | `apps/web/tests/integration` 或 `packages/auth/tests-integ` | Prisma Session 表事务；`otpRequest→otpVerify→register→tutor.ask` 全链；reuse-detection 真起 2 个 refresh；ratelimit 真起 Redis 容器 | 起 Postgres + Redis（Testcontainers）；LLM/SMS/微信 mock |
| E2E | `apps/web/e2e/auth-otp.spec.ts` | OTP 完整链：输手机号 → 拿 `TestSmsAdapter` 内存中的明文 code → 输码 → register → 进 /tutor 问 | E2E DB `zhijiao_test`；AI MockAdapter；SMS `TestSmsAdapter` |
| E2E | `apps/web/e2e/auth-wechat.spec.ts` | 微信 mock 完整链：点登录 → `MockWechatH5Adapter` 按 url code 返 fake openid → register → tutor.ask | `WECHAT_OAUTH_USE_MOCK=true` |
| E2E | `apps/web/e2e/tutor.spec.ts`（改） | 登录后再问 | 替换原 anon 流程 |

### 6.4 关键测试细节

- **OTP 明文怎么拿**：`TestSmsAdapter` 把 `(phone, code)` 推入内存 `Map<phone, code[]>`；测试 helper 直接读 adapter。**绝不** 反推 `codeHash`（单向 hash 不可逆），**绝不**改 procedure 让测试期返码到 response。
- **Reuse detection 测试**：拿 refresh A → rotate 得 refresh B → 再用 A 调 `/api/auth/refresh` → 断言 401 REUSE_DETECTED + DB 中该 user 全部 session `revokedAt` 非空。
- **Ratelimit 测试**：注入 fake clock 打满 bucket，断言第 N+1 次拒绝 + `retryAfterMs` 正确。
- **WeChat state 校验**：构造 cookie state 与 url state 不一致 / Redis 中 state 已被 GETDEL → 断言 `WECHAT_STATE_MISMATCH`。
- **Refresh fail-open ratelimit 不阻挡测试**：integration 测试默认走 `InMemoryStore` 即可；专测 fail-close 用 mock 抛错。

---

## 7. 明确**不做**

| 类别 | 不做 | 原因 |
|---|---|---|
| 集成 | 真接阿里云短信生产 | 资质 + 模板审批；adapter 留好 |
| 集成 | 真接微信公众号 | ICP + secret；adapter 留好 |
| 集成 | 微信开放平台扫码 / 小程序 / 微信支付 | 后续 plan |
| 鉴权 | 完整账户合并工具 | 涉及 Conversation/Attempt/Credit 迁移；冲突仅提示 |
| 计费 | Credit 体系完整逻辑 | 仅占位中间件；Plan 3 |
| 家长 | ParentChildLink + 家长同意流 | 单独 plan |
| 教师 | 资质审核 / 上架 / 班级管理 | 单独 plan |
| 运营 | apps/admin UI | 单独 plan；OPS/ADMIN 通过 seed 与命令行 |
| 设备 | 设备管理 UI | procedure 已暴露，UI 单独 plan |
| 中间件 | Next middleware 做 DB session rotation / Prisma | Edge runtime 不友好；refresh 由 route handler 处理 |

---

## 8. 后续工作

1. **本 spec 经用户审核后**，由 `superpowers:writing-plans` 接手输出 implementation plan。Plan 大致顺序：
   1. Prisma schema delta + migration + seed 重写
   2. `packages/auth` 骨架（jwt / cookies / errors / ratelimit InMemoryStore + RedisStore / session / otp）
   3. `packages/integrations` 骨架（aliyun/sms 三实现 + wechat/h5-oauth 三实现）
   4. `apps/web/server`（tRPC trpc.ts / context.ts / routers / middleware）
   5. `apps/web/app/api/auth/{refresh,logout}` route handlers + `app/(auth)/wechat/{start,callback}` route handlers
   6. `apps/web/app/(auth)/{login,otp-verify,register}` 页面 + 组件
   7. 旧 `actions.ts` 删除、`lib/ai-client.ts` 重构、`tutor.ask` procedure
   8. `middleware.ts` route guard
   9. 测试：单元 / 集成 / E2E 三层全补
   10. CLAUDE.md 更新（auth 现状 + 新命令）

2. **`.env.example` 新增**：
   ```
   ACCESS_JWT_SECRET=
   REFRESH_NONCE_SECRET=      # 用于 register nonce 与其它短期签名
   OTP_PEPPER=                 # codeHash 的 pepper
   REDIS_URL=redis://localhost:6379

   ALIYUN_SMS_ACCESS_KEY_ID=
   ALIYUN_SMS_ACCESS_KEY_SECRET=
   ALIYUN_SMS_SIGN_NAME=
   ALIYUN_SMS_TEMPLATE_CODE=
   SMS_USE_MOCK=true            # dev 默认 true；prod 必须 false

   WECHAT_H5_APPID=
   WECHAT_H5_SECRET=
   WECHAT_OAUTH_USE_MOCK=true   # dev 默认 true
   ```

3. **docker-compose.yml 新增** Redis（已在 §5 隐含）。

4. **CLAUDE.md 更新**："开始实现时"节加 Plan 2 的命令行与状态说明；下一步候选 Plan 改成 Plan 3（Credit）+ Plan 4（举一反三）。

---

## 附录 A：Brainstorming Q&A trace

| # | 问 | 答 |
|---|---|---|
| Q1 | Plan 2 收官状态？ | MVP：OTP + Session/JWT + tRPC 真走，微信先占位 |
| Q2 | 鉴权底层路线？ | 自建（jose + Prisma Session） |
| Q3 | 4 件核心件之外打包哪些？ | GradeLevel + 未成年面、账号绑定、限频防刷；TEACHER 不做审核（人人能出卷） |
| Q4 | "人人都可以出卷"含义？ | TEACHER 转 persona（不审核）；权限 `PAPER_GEN/LESSON_PLAN_GEN/PPT_GEN` 对所有登录用户开放；Role 缩为 OPS/ADMIN |
| Q5 | tRPC 改造范围？ | 一并迁，删旧 server action 与 DEV_USER_ID |
| Q6 | A1（Prisma Session）+ B1（Real/Mock 双实现微信 adapter）？ | 两个推荐都走 |
| Q7 | Redis 挂时限频？ | OTP 发送/校验 fail-close；其他 fail-open |

## 附录 B：用户在 spec 演进中提出的硬约束 / 修订

1. middleware.ts 不做 silent refresh；refresh 走 Node runtime route handler
2. 删除 `wechat/verify.ts` 占位（避免假完成）
3. WechatBinding 抽象成通用 `AuthIdentity`；唯一键不接受 nullable 列 → 引入非空 `providerScope`
4. callback 不在 tRPC 和 route handler 同时存在两套入口；callback 仅 route handler
5. 注册分两步流（OTP 验证后 → 跳 /register）
6. 客户端 refresh-on-401 仅处理 ACCESS_EXPIRED，最多重试 1 次
7. 微信首次登录不静默建默认 STUDENT；走与手机号统一的 registerToken 流
8. auth.logout 改 `/api/auth/logout` route handler（refresh cookie path 限制）
9. §3.6 refresh 查询不带 `revokedAt IS NULL`，改先查后分支
10. wechatStart 改 GET route handler，不走 tRPC
11. `__Host-` 前缀 cookies 显式标注 `Secure + Path=/ + 无 Domain`
12. bindMode state 不明文编码 userId，改 Redis 存 `{mode,userId,csrf}` + UUID GETDEL
13. tRPC 错误 code 必须用原生支持值（移除 `SERVICE_UNAVAILABLE` / `PAYMENT_REQUIRED`）
14. registerToken cookie 仅在成功 / token 无效时清，不因表单错误清
15. OTP E2E 只通过 `TestSmsAdapter` 读明文 code，不提 codeHash 反推
