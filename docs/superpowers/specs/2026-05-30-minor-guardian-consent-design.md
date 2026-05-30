# Plan 14a: 未成年人监护人同意（<14 硬门禁）— Design

> 状态：草案，待用户审阅。
> 来源：Plan 14（未成年人保护 / PIPL 完版）拆分出的第一个子项。另两子项独立成 plan：14b DSAR 请求 + SLA、14c 通用 PII 扫描器。
> 法务依据：PIPL 对 <14 个人信息要求取得监护人同意，且同意可撤回。
> 关联：接续 Plan 6（PII 治理）、复用 Plan 11（FamilyLink 家长绑定）。

## 1. 目标与非目标

**目标**

- 可靠识别 <14 用户，并在取得监护人同意**前**对其账号施加硬门禁（PIPL 同意前最小化处理）。
- 监护人同意作为可审计事件落库（谁 / 何时 / 范围 / 方式），支持撤回。
- 同意流程复用 Plan 11 FamilyLink 管道，不另造关系模型。
- PII 治理（Plan 6）覆盖新增的 `GuardianConsent` 与 `birthYear`。

**非目标（YAGNI / 划到别的 plan）**

- DSAR 用户侧请求入口与 SLA → Plan 14b。
- 通用 PII（手机号 / 身份证）正则扫描器 → Plan 14c。
- 14–17 岁未成年的额外保护（PIPL 显式监护人同意规则针对 <14；14–17 沿用既有 `isMinor` 的 billing 上限）。
- 监护人身份的强校验（实名 / 关系证明）；MVP 以"已注册 PARENT 账号 + 显式同意勾选"为准。
- 既有无 `birthYear` 用户的强制回填（见 §6 默认①，grandfather）。

## 2. 数据模型

新增/改动（`packages/db/prisma/schema.prisma`），需 migration。

**User 增字段**

- `birthYear Int?  @map("birth_year")` —— 自报出生年份。注册时 `STUDENT` persona 必填；`TEACHER`/`PARENT` 不收（视为成年）。
- `guardianConsentStatus GuardianConsentStatus @default(NOT_REQUIRED) @map("guardian_consent_status")` —— 承重字段，门禁中间件单次读取（与 `isMinor` 同模式，不进 JWT）。

**新枚举**

```prisma
enum GuardianConsentStatus {
  NOT_REQUIRED  // ≥14 或成年 persona
  PENDING       // <14 且尚无有效监护人同意 → 硬门禁
  GRANTED       // <14 且存在 ≥1 个有效（未撤回）监护人同意
}
```

**新表 GuardianConsent（同意审计真源）**

```prisma
model GuardianConsent {
  id             String    @id @default(cuid())
  childUserId    String    @map("child_user_id")
  guardianUserId String    @map("guardian_user_id")
  consentScope   String    @map("consent_scope")   // MVP 固定 "FULL_SERVICE"，预留多范围
  method         String                            // "FAMILY_LINK_BIND"（字面值，不引 enum，仿 KP taskKind）
  consentedAt    DateTime  @default(now()) @map("consented_at")
  revokedAt      DateTime? @map("revoked_at")
  createdAt      DateTime  @default(now()) @map("created_at")

  child    User @relation("ChildConsents",    fields: [childUserId],    references: [id], onDelete: Cascade)
  guardian User @relation("GuardianConsents", fields: [guardianUserId], references: [id], onDelete: Cascade)

  @@index([childUserId])
  @@index([guardianUserId])
  @@map("guardian_consents")
}
```

- 允许一个 child 有多个监护人（多行）。不设 `@@unique([child,guardian])` —— 同一对可能撤回后重新同意（保留历史行，revokedAt 区分）；幂等由流程保证（见 §4）。
- `onDelete: Cascade` 两侧：注销任一方物理删该行（§6 PII；与 FamilyLink 的 `Restrict` 不同——consent 行随人走，不作财务级留存）。

**`isUnder14` 判定（保守，年份粗粒度宁可多触发）**

纯函数（放 `apps/web/server/lib/consent.ts`，无 Prisma 依赖；web-only 消费方，不进 domain 包）：

```ts
// 出生年使最小可能年龄 < 14 即触发。例（2026）：birthYear 2012 → 2026-2012=14 → 触发；2011 → 15 → 不触发。
export function isUnder14(birthYear: number, now: Date = new Date()): boolean {
  return now.getFullYear() - birthYear <= 14;
}
```

**`deriveGuardianConsentStatus`**

```ts
// 注册期初始状态：STUDENT 且 <14 → PENDING；否则 NOT_REQUIRED。
export function initialConsentStatus(persona: Persona, birthYear: number | null): GuardianConsentStatus {
  if (persona === "STUDENT" && birthYear != null && isUnder14(birthYear)) return "PENDING";
  return "NOT_REQUIRED";
}
```

## 3. 注册流程改动

`apps/web/server/routers/auth.ts` 的 `register`：

- `RegisterInput` 加 `birthYear: z.number().int().min(1990).max(new Date().getFullYear()).optional().nullable()`。
- 校验：`persona === "STUDENT" && birthYear == null` → 表单错误（不清 register cookie，让用户补；仿现有 gradeLevel 缺失处理）。
- `deriveIsMinor(persona, gradeLevel)` 保留（billing 不变）。
- 新增 `guardianConsentStatus = initialConsentStatus(persona, birthYear)`，写入 User。
- 注册成功仍发 session（用户可登录），但若 PENDING 则落入硬门禁。

## 4. 同意获取（复用 FamilyLink）

**童侧（PENDING）**

- 登录后被页面 middleware 导向 `/guardian-consent` 引导页。
- 页面调 `family.createInviteCode`（白名单放行，见 §5）生成 15min TTL 单次邀请码，展示给监护人。

**监护人侧（PARENT 账号）**

- `family.bindByCode` 扩展：解析出 child 后，若 `child` 的 `guardianConsentStatus === "PENDING"`（即 <14 待同意）：
  - **要求** input 带 `guardianConsent: true`（zod 默认 false；缺失/false → `BAD_REQUEST / GUARDIAN_CONSENT_NOT_PROVIDED`，附同意声明文案 key，前端展示）。
  - 同一事务：
    1. 写 `GuardianConsent`（childUserId, guardianUserId, consentScope="FULL_SERVICE", method="FAMILY_LINK_BIND", consentedAt=now）。
    2. upsert ACTIVE `FamilyLink`（复用 Plan 11 既有 upsert/复活逻辑）。
    3. child `guardianConsentStatus = "GRANTED"`。
- 普通 ≥14 学生绑定（child 状态 NOT_REQUIRED）：走原 Plan 11 逻辑，**不写** consent、**不改** status、**不要求** `guardianConsent` 字段。
- 幂等：同一 guardian 重复对已 GRANTED 的 child bind → 复用既有 FamilyLink 幂等；不重复写 consent（若已存在该 (child,guardian) 的有效行则 no-op，否则补写）。

## 5. 硬门禁

**tRPC 中间件 `requireGuardianConsent`**

- `ctx.auth.guardianConsentStatus === "PENDING"` → `throw TRPCError(FORBIDDEN, "GUARDIAN_CONSENT_REQUIRED")`。
- 挂载方式：挂在 `authedProcedure` 之上形成 `consentGatedProcedure`，**绝大多数** authed procedure 改用它；白名单 procedure 继续用裸 `authedProcedure`，即同意流程必需项：
  - `family.createInviteCode`（童发码）
  - `auth.me`（读自身状态以渲染引导页）
  - 登出 / session 相关
- `ctx.auth` 增 `guardianConsentStatus`：在 `createContext` 查 User 时一并取（与现有 `isMinor` 同一次查询，不进 JWT，避免 token 失效）。

**Next 页面 middleware**（`apps/web/middleware.ts`）

- PENDING 用户访问受保护页 → 重定向 `/guardian-consent`。`/guardian-consent` 自身与登录/登出豁免。

## 6. PII 治理（接 Plan 6）

- **注销 child**（`deactivateUser`）：物理删其作为 child 的 `GuardianConsent` 行（Cascade）；payload 只记 `guardianConsentsAsChild` 计数。
- **注销 guardian**：删其作为 guardian 的 `GuardianConsent` 行；对每个受影响 child，若失去全部有效（revokedAt=null）consent → 置 child `guardianConsentStatus = "PENDING"`（重新门禁）；payload 只记计数。
- **导出**（`exportUserData`）：含本人作为 child 的 consent（`guardianUserId` 仅 masked）、本人 `birthYear`；不含对方 PII。
- **去标识化**：注销时 `birthYear` scrub 为 null。
- **payload guard**：`OpsActionLog.payload` 禁词集加 `birth_year` / `birthYear` / `guardian_user_id` / `child_user_id`。
- **默认①（已与用户确认）**：既有无 `birthYear` 用户 grandfather —— `guardianConsentStatus` 默认 NOT_REQUIRED，不硬锁旧账号。规划期、仅 seed 测试用户、无真实未成年，MVP 接受。后续可加"登录补 birthYear"流程（独立工作）。

## 7. 撤回

单一入口：扩展既有 `family.revoke`（不另造 `withdrawConsent`，避免两条路径）。

- `family.revoke` 撤销 link 时，若涉及的 child 是 <14（曾 GRANTED）：同一事务写对应 `GuardianConsent.revokedAt = now`，再重算 child 状态——若失去全部有效（`revokedAt = null`）consent → child 回 `PENDING`（重新硬门禁）。
- 谁能触发：沿用 Plan 11「任一方可撤」。无论监护人还是童发起，结果都是童被重新门禁（更受限方向，童无法借此逃脱门禁，安全）。同意的**撤回权**实质归监护人（撤回即移除其同意行）。
- child `GRANTED` 的判定 = 存在 ≥1 个 `revokedAt = null` 的 consent。`guardianConsentStatus` 字段与 consent 行的一致性由两处写操作维护：`family.revoke`（本节）与注销 guardian（§6）。

## 8. 测试与验收

**单元（`apps/web/server/lib/consent.ts`）**

- `isUnder14` 年份边界：当前年 2026 下 birthYear 2012→true、2011→false、2014→true。
- `initialConsentStatus`：STUDENT+<14→PENDING；STUDENT+≥14→NOT_REQUIRED；TEACHER/PARENT→NOT_REQUIRED；birthYear null→NOT_REQUIRED。

**集成**

- register：STUDENT <14 → 落 PENDING + birthYear 入库；≥14 → NOT_REQUIRED；STUDENT 缺 birthYear → 表单错误不清 cookie。
- 门禁中间件：PENDING 调受保护 procedure → `GUARDIAN_CONSENT_REQUIRED`；调白名单（`family.createInviteCode` / `auth.me`）→ 放行。
- bind 带 consent（child PENDING）→ 写 GuardianConsent + FamilyLink ACTIVE + child GRANTED + 解禁；缺 consent → `GUARDIAN_CONSENT_NOT_PROVIDED` 不写任何行。
- bind 普通 ≥14（NOT_REQUIRED）→ 不写 consent、不要求 consent 字段（Plan 11 回归）。
- 撤回：`family.revoke` → 对应 revokedAt 落 + child 回 PENDING（无其它有效 consent 时）；仍有其它有效 consent 时维持 GRANTED。
- 多监护人：两 guardian 同意同一 child → 撤其一仍 GRANTED。

**PII**

- 注销 child 删其 consent + payload 计数；注销 guardian 删 consent + 受影响 child 回 PENDING；导出含本人 birthYear/consent（对方 masked）；payload guard 禁词。

**E2E**

- `<14 注册 → 登录落 /guardian-consent → 发码 → 家长 PARENT 绑定并勾选同意 → child 解禁可用` 闭环。

**CLAUDE.md 红线（落地后补）**

- 门禁在受保护 procedure 生效：PENDING 调非白名单 → `GUARDIAN_CONSENT_REQUIRED`。
- bind <14 必须带 consent 才写行：缺 consent 不写 GuardianConsent / 不改 status。
- PII 覆盖 GuardianConsent + birthYear（注销删除 / 导出白名单 / payload 禁词）。

## 9. 文件清单（落地预览）

| 文件 | 动作 |
|---|---|
| `packages/db/prisma/schema.prisma` | User 加 `birthYear`/`guardianConsentStatus`、新 enum、新 `GuardianConsent` + migration |
| `apps/web/server/lib/consent.ts` | `isUnder14` / `initialConsentStatus` 纯函数 + 单测 |
| `apps/web/server/context.ts` | `ctx.auth` 增 `guardianConsentStatus`（同 isMinor 查询） |
| `apps/web/server/trpc.ts`（或 procedures 定义处） | `requireGuardianConsent` 中间件 + `consentGatedProcedure` |
| `apps/web/server/routers/auth.ts` | `RegisterInput.birthYear` + register 写状态 |
| `apps/web/server/routers/family.ts` | `bindByCode` <14 consent 分支 + `revoke` 撤回写 revokedAt 并回 PENDING |
| `apps/web/server/lib/pii-governance.ts` | 注销/导出/payload guard 覆盖 GuardianConsent + birthYear |
| `apps/web/middleware.ts` | PENDING → `/guardian-consent` 重定向 |
| `apps/web/app/.../guardian-consent/page.tsx` | 童引导页（发码）+ 家长同意声明文案 |
| 各 procedure 路由 | 批量改挂 `consentGatedProcedure`（白名单除外） |

## 10. 已知取舍

- **默认②（已确认）**：`birthYear` 仅 STUDENT 必填；TEACHER/PARENT 视为成年 NOT_REQUIRED。
- 年份粗粒度判龄会"宁可多触发"（14 整岁也门禁），可接受（保守合规）。
- 监护人身份不强校验（MVP）：只要对方是 PARENT 账号 + 勾选同意即成立。强实名校验留后续。
- 批量把 authed procedure 改挂 `consentGatedProcedure` 是一次性机械改动；白名单需逐一核对，落地计划显式列出白名单清单作守门。
