# 智教 · Plan 9 知识点 Reconciler Design

> Spec 是 Plan 9 的真理来源；实现 plan 引用本 spec 章节号。

## §1 目标 + 范围 + 显式 punt

**目标：** 把 Plan 4 / Plan 8 已经产出的 `knowledgePointHints` 字符串（自由文本，AI 给出）落到 `Question.knowledgePoints`（`QuestionKPLink` 结构化 m-to-m 表）上，为 Plan 10（教师分层作业）、Plan 11（学情画像）提供结构化数据。

**核心架构 4 条：**

1. **QuestionKPLink 是权威映射** —— 现有表保持现状只存 `(questionId, kpId, weight)`，是消费端唯一权威。不在它上面加 status / source / confidence 字段；所有 provenance 落新表 `KpReconcileMatch`。
2. **2 层匹配 + 1 层人工** —— 同步路径只跑免费规则（EXACT KP.name/code → ALIAS 表），命中即刻落；未命中入队 UNMATCHED，留给手动触发的异步 LLM 兑底；LLM 结果按置信度三档分流，低 / 中档进 PENDING_REVIEW 队列等人工。
3. **CLI 不上 Web** —— 单人 dev，OPS 操作走 `pnpm.cmd --filter @zhijiao/web kp:review` 交互式脚本，service 层接口写成可被未来 Web 包的形式（memory: [[zhijiao-single-dev-no-ops-ui]]）。
4. **VariantItem hints 不污染 parent question** —— 变式题（特别 L3）可能跨越原题知识点范围，本 plan 任何 `sourceRefType=VARIANT_ITEM` 的 reconcile 行**永远不自动写** `QuestionKPLink`，最多落 PENDING_REVIEW 等人工 approve。

**范围（本 plan 做）：**

- 2 张新表 `KpAlias`、`KpReconcileMatch` + 配套 enum
- `apps/web/server/lib/kp-reconcile.ts` 服务层：`reconcileHintsSync` / `approveMatch` / `rejectMatch` / `remapMatch` / `learnAliasAndLink` / `unlinkIfOrphan` 6 个函数
- 3 个 router body 接入：`tutor.ask` / `error.diagnose` / `variant.generateForEntry`
- 2 个 CLI 脚本：`apps/web/scripts/kp-reconcile-pending.ts` + `apps/web/scripts/kp-review.ts`
- 1 个一次性脚本：`apps/web/scripts/kp-backfill-variant-items.ts`
- `packages/ai/src/prompts/kp-reconciliation/v1.md` + `packages/ai/src/router.ts` 加 `kpReconcile()` 方法 + mock + zod schema
- `packages/db/prisma/seed/2_kp_aliases.ts`：8-12 条手工策展初始 alias
- 测试：unit / integration（含 7 个 sync/state/subject 测例）
- CLAUDE.md 更新（状态条目 + Merge 探针 30-34）

**显式 punt（写进本 spec + plan "不做" 清单）：**

- Web `/ops/kp-reconcile` 页面 → 等真有 OPS / 教师角色再做
- CLI 暴露 `LINKED → REJECTED` 反悔入口（只写 `unlinkIfOrphan` helper + 文档化规则）→ 后续如积累批量误匹配，再开 ad-hoc 脚本
- cron 自动跑 `kp:reconcile-pending` → LLM 成本不可见、prompt 初期需观察，暂手动
- KP 树扩充 / 引入更多学科 KP / grade level 关联 → 独立 plan
- VariantItem 升格成独立 `Question` + 自己的 `QuestionKPLink` → 独立 plan（Plan 12 题库去重时一起考虑）
- 学情画像 / 教师分层作业（消费端）→ Plan 10 / Plan 11
- 跨学科 alias 治理（同一 normalizedAlias 多学科语义不同）→ KpAlias `@@unique([subjectId, normalizedAlias])` 已挡住，无需额外治理
- Embedding / 向量召回 → 本仓未接 vector 基建，YAGNI

---

## §2 Schema 变更

### §2.1 KpAlias

```prisma
model KpAlias {
  id               String        @id @default(cuid())
  subjectId        String        @map("subject_id")
  kpId             String        @map("kp_id")
  normalizedAlias  String        @map("normalized_alias")
  source           KpAliasSource
  createdAt        DateTime      @default(now()) @map("created_at")
  createdByUserId  String?       @map("created_by_user_id")   // CLI_MANUAL 时记录是谁加的；SEED 为 null

  subject          Subject       @relation(fields: [subjectId], references: [id])
  kp               KnowledgePoint @relation(fields: [kpId], references: [id])
  createdBy        User?         @relation("KpAliasCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@unique([subjectId, normalizedAlias])  // 同 subject 下 normalizedAlias 唯一
  @@index([kpId])
  @@map("kp_aliases")
}

enum KpAliasSource {
  SEED         // pnpm db:seed 灌入
  CLI_MANUAL   // kp:review 的 alias <kpCode> 学到
}
```

**为什么 `@@unique([subjectId, normalizedAlias])` 不是全局：** "函数" 在初中数学、高中数学、信息技术里语义可能不同；既然匹配本身已经按 `question.subjectId` 限定，alias 也跟着 subject 走，避免跨学科误匹配（spec §3.2.5 的学科隔离防御一致）。

### §2.2 KpReconcileMatch

```prisma
model KpReconcileMatch {
  id              String                      @id @default(cuid())
  questionId      String                      @map("question_id")
  kpId            String?                     @map("kp_id")    // 三态语义见 §5.1
  rawHint         String                      @db.Text @map("raw_hint")
  normalizedHint  String                      @map("normalized_hint")
  source          KpReconcileSource
  sourceRefType   KpReconcileSourceRefType    @map("source_ref_type")
  sourceRefId     String                      @map("source_ref_id")
  matchVia        KpReconcileMatchVia?        @map("match_via")        // UNMATCHED 时 null
  confidence      Float?                                                  // EXACT/ALIAS/MANUAL=1.0；LLM=0..1；UNMATCHED=null
  status          KpReconcileMatchStatus      @default(UNMATCHED)
  reviewReason    KpReconcileReviewReason?    @map("review_reason")    // 只在 status=PENDING_REVIEW 时填
  modelCallId     String?                     @map("model_call_id")    // LLM 路径下指向 ModelCall row
  reviewedAt      DateTime?                   @map("reviewed_at")
  reviewedByUserId String?                    @map("reviewed_by_user_id")
  createdAt       DateTime                    @default(now()) @map("created_at")
  updatedAt       DateTime                    @updatedAt @map("updated_at")

  question        Question                    @relation(fields: [questionId], references: [id], onDelete: Cascade)
  kp              KnowledgePoint?             @relation(fields: [kpId], references: [id], onDelete: SetNull)
  reviewedBy      User?                       @relation("KpReconcileReviewer", fields: [reviewedByUserId], references: [id], onDelete: SetNull)
  modelCall       ModelCall?                  @relation(fields: [modelCallId], references: [id], onDelete: SetNull)

  @@unique([sourceRefType, sourceRefId, normalizedHint])  // 幂等 key，见 §3.4
  @@index([status, createdAt])                            // CLI 队列扫
  @@index([questionId])                                   // 详情/统计
  @@map("kp_reconcile_matches")
}

enum KpReconcileSource {
  ERROR_ANALYSIS  // error.diagnose body sync 调用
  VARIANT_ITEM    // variant.generateForEntry body sync 调用
  TUTOR_ADHOC     // tutor.ask body sync 调用
  BACKFILL        // 一次性 backfill 脚本扫历史 VariantItem
}

enum KpReconcileSourceRefType {
  ERROR_BOOK_ENTRY  // sourceRefId = ErrorBookEntry.id
  VARIANT_ITEM      // sourceRefId = VariantItem.id（实时或 backfill）
  QUESTION          // sourceRefId = Question.id（TUTOR_ADHOC 路径指向 USER_ADHOC 题本身）
}

enum KpReconcileMatchVia {
  EXACT    // KP.name / KP.code 直接命中
  ALIAS    // KpAlias 表命中
  LLM      // 异步 LLM 兑底
  MANUAL   // CLI 人工 approve/remap/alias
}

enum KpReconcileMatchStatus {
  UNMATCHED       // sync 未命中，等异步 LLM
  PENDING_REVIEW  // 等人工：LLM 中档置信 / VARIANT_ITEM 待写 parent
  LINKED          // 已写 QuestionKPLink（QuestionKPLink 落库的唯一通道）
  REJECTED        // 人工拒绝，不再处理
  DROPPED         // LLM 低置信 / NO_MATCH，不进队列（仅留 audit）
}

enum KpReconcileReviewReason {
  LLM_CONFIDENCE_BAND              // LLM 给的 0.6–0.85 区间
  VARIANT_TO_PARENT_NEEDS_REVIEW   // VARIANT_ITEM 命中 EXACT/ALIAS/LLM≥0.85，是否写 parent QuestionKPLink 需人工
}
```

### §2.3 ModelCall.taskKind 不改 enum

`ModelCall.taskKind` 现是 `String`，不是 enum。Plan 9 只在写入时用字面值 `"KP_RECONCILE"`，**不改** ModelCall schema 引入 enum，避免牵动历史所有 AI task（TUTOR_TURN / ERROR_ANALYSIS / VARIANT_GROUP_GEN）。

### §2.4 Migration 工艺（沿用 Plan 4 / Plan 8 红线）

1. `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan9_kp_reconciler`
2. 检查 `migration.sql`（Plan 9 不需要 partial unique idx，因为 `@@unique([subjectId, normalizedAlias])` 和 `@@unique([sourceRefType, sourceRefId, normalizedHint])` 都是全集 unique，Prisma 5 schema 直接支持，不必手动追加 raw SQL）
3. `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev` apply
4. `pnpm.cmd test:setup` 复制到 per-pkg test DB

---

## §3 同步匹配路径 reconcileHintsSync

### §3.1 函数签名 + 调用点

```ts
// apps/web/server/lib/kp-reconcile.ts
export async function reconcileHintsSync(
  prisma: PrismaClient,
  args: {
    questionId: string;
    hints: string[];
    source: "ERROR_ANALYSIS" | "VARIANT_ITEM" | "TUTOR_ADHOC" | "BACKFILL";
    sourceRefType: "ERROR_BOOK_ENTRY" | "VARIANT_ITEM" | "QUESTION";
    sourceRefId: string;
  },
): Promise<{ linked: number; queued: number; alreadySeen: number }>;
```

**三个调用点（spec §6 详）：**

- `tutor.ask` body：AI 成功 + upsertUserAdhocQuestion 成功后；source=TUTOR_ADHOC, sourceRefType=QUESTION, sourceRefId=question.id
- `error.diagnose` body：entry upsert 成功后；source=ERROR_ANALYSIS, sourceRefType=ERROR_BOOK_ENTRY, sourceRefId=entry.id（**不**用 diagnoseLedgerId —— ledger 是计费 audit，业务来源应指 entry 本身）
- `variant.generateForEntry` body：VariantGroup + VariantItem 落库后，对每个 VariantItem 调用；source=VARIANT_ITEM, sourceRefType=VARIANT_ITEM, sourceRefId=variantItem.id

调用方式 **await + try/catch**（详 §3.4）；**永远不能让 reconcile 失败破坏主流程**（用户已付费拿到讲解 / 错因 / 变式，KP reconcile 是后台增强）。

### §3.2 normalize + matching 算法

#### §3.2.1 `normalizeKpHint`

```ts
export function normalizeKpHint(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}
```

跟 Plan 8 `normalizeStem` 不同：KP 名称域里大小写不带语义（"一元一次方程"、"Linear Equation"、"移项" 都是概念标签），可以 lowercase。题面 stem 大小写有数学含义（A vs a / X vs x），Plan 8 拒绝 lowercase。两者用意不同，不混用。

#### §3.2.2 候选 KP 集 + alias 表内存 map

每次 `reconcileHintsSync` 调用开始：

1. 查一次 `question.subjectId`
2. 加载该 subject 下全部 KP：`prisma.knowledgePoint.findMany({ where: { subjectId } })`
3. 加载该 subject 下全部 alias：`prisma.kpAlias.findMany({ where: { subjectId } })`
4. 构造内存 map：
   - `kpByNormalized: Map<string, kpId>` 由 `normalizeKpHint(kp.name)` 和 `normalizeKpHint(kp.code)` 双键填充
   - `aliasByNormalized: Map<string, kpId>` 由 `kpAlias.normalizedAlias` 直接键

5. 所有 hint 内存查 map，命中即得 kpId

**为什么不只用 Prisma `mode: "insensitive"`：** Prisma 不能做空白折叠（"  一元 一次 方程" vs "一元一次方程"）。先 normalize → map 查更确定。当前 KP 量级小（math 4 个），加载全部成本可忽略；上百以后再考虑分页 / 按 grade level 过滤。

#### §3.2.3 单条 hint 流程

```
normalized = normalizeKpHint(rawHint)
↓
kpId = kpByNormalized.get(normalized)
  → 命中 → matchVia=EXACT, confidence=1.0, kpId=found
↓ 未命中
kpId = aliasByNormalized.get(normalized)
  → 命中 → matchVia=ALIAS, confidence=1.0, kpId=found
↓ 未命中
→ matchVia=null, confidence=null, kpId=null, status=UNMATCHED
```

### §3.3 状态判定（按 sourceRefType 分流）

**关键设计：** 决定"是否自动写 parent QuestionKPLink" 的条件是 **sourceRefType=VARIANT_ITEM 与否**（不是 source）。这覆盖了实时（source=VARIANT_ITEM）+ backfill（source=BACKFILL + sourceRefType=VARIANT_ITEM）两种情况。

| sourceRefType | matchVia | LLM 区间 | status | kpId | confidence | reviewReason | 写 QuestionKPLink? |
|---|---|---|---|---|---|---|---|
| ERROR_BOOK_ENTRY / QUESTION | EXACT/ALIAS | — | LINKED | matched | 1.0 | null | 是，upsert weight=1.0 |
| ERROR_BOOK_ENTRY / QUESTION | LLM | ≥0.85 | LINKED | matched | conf | null | 是，upsert weight=conf |
| ERROR_BOOK_ENTRY / QUESTION | LLM | 0.6–0.85 | PENDING_REVIEW | matched | conf | LLM_CONFIDENCE_BAND | 否，待 CLI `a` |
| VARIANT_ITEM | EXACT/ALIAS | — | PENDING_REVIEW | matched | 1.0 | VARIANT_TO_PARENT_NEEDS_REVIEW | 否，待 CLI `a` |
| VARIANT_ITEM | LLM | ≥0.85 | PENDING_REVIEW | matched | conf | VARIANT_TO_PARENT_NEEDS_REVIEW | 否，待 CLI `a` |
| VARIANT_ITEM | LLM | 0.6–0.85 | PENDING_REVIEW | matched | conf | LLM_CONFIDENCE_BAND | 否 |
| 任意 | LLM | <0.6 / NO_MATCH | DROPPED | null | conf 或 null | null | 否 |
| 任意 | sync miss, 未跑 LLM | — | UNMATCHED | null | null | null | 否 |

`PENDING_REVIEW` 行的 `kpId` 始终填**推荐值**（不是 null），便于 CLI 一行显示 "Suggested KP"。`a` 操作直接采纳 row.kpId 写 QuestionKPLink；`m <code>` 覆盖 kpId 再写。

### §3.4 幂等 + 错误处理

#### §3.4.1 幂等 key

`KpReconcileMatch @@unique([sourceRefType, sourceRefId, normalizedHint])`。

- tutor.ask 同 stem 再提交（dedup → 同 questionId → 同 hints）→ 同 (sourceRefType=QUESTION, sourceRefId=question.id, normalizedHint) → upsert/no-op
- backfill 重跑同 VariantItem → 同 (VARIANT_ITEM, variantItem.id, normalizedHint) → no-op

P2002 catch 模式（与 Plan 8 `upsertUserAdhocQuestion` 同款）：
```ts
try {
  await prisma.kpReconcileMatch.create({ data: ... });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    // 已存在 → bump alreadySeen 计数 → 不抛
    return { existed: true };
  }
  throw e;
}
```

#### §3.4.2 错误处理边界

调用方包 try/catch：

```ts
// router body 中（tutor.ts / error.ts / variant.ts）
try {
  await reconcileHintsSync(ctx.db, { ... });
} catch (e) {
  logger.warn({ event: "kp_reconcile_sync_failed", source, sourceRefId, error: String(e) });
}
// 即使 throw，主流程已经成功（return 业务结果）
```

reconcile 内部异常（DB 连接断、单条 hint 写入失败）按"单条 hint 隔离" —— 一条 hint 写挂不影响同批其它 hint，每条 hint 各自 try/catch。

#### §3.4.3 学科错配防御

理论上 `KpAlias @@unique([subjectId, normalizedAlias])` 已经挡住跨学科 alias，但 `aliasByNormalized` map 命中的 kpId 还是要再 assert `kp.subjectId === question.subjectId`，命中错配 → 当 miss 处理 + warn 日志（防御未来某种数据脏写）。

---

## §4 异步 LLM 路径 kp:reconcile-pending

### §4.1 批处理 + 批量限制

```
pnpm.cmd --filter @zhijiao/web kp:reconcile-pending [-- --limit N]
```

默认 `--limit 50`。调 prompt 时可以传 `--limit 5` / `--limit 10` 小批量试。

`apps/web/scripts/kp-reconcile-pending.ts` 流程：

1. 取 UNMATCHED 行 limit N，按 `createdAt asc` 排序：
   ```ts
   const batch = await prisma.kpReconcileMatch.findMany({
     where: { status: "UNMATCHED" },
     orderBy: { createdAt: "asc" },
     take: limit,
     include: { question: { select: { subjectId: true } } },
   });
   ```

2. 按 subjectId group by；每个 subject 单独跑 LLM（不同 subject 用不同 KP 候选集）

3. 每个 subject 批内：拉该 subject 全部 KP（id / code / name / description / parent 路径）传给 LLM；超 100 个 KP 时再考虑按 grade level 过滤

4. 调 `aiRouter.kpReconcile({ subjectId, candidates, hints })` 拿 LLM 输出（详 §4.2）

5. 写 `ModelCall(taskKind="KP_RECONCILE", inputDigest, outputJson, status)`，本批所有 match 的 `modelCallId` 都指向这一条 ModelCall

6. 按 §3.3 表分流（这次 matchVia=LLM）更新 KpReconcileMatch.status，LINKED 时 upsert QuestionKPLink

7. 控制台输出批次摘要：
   ```
   Batch 1/2 (subject=math, total UNMATCHED=23): 18 hints → 6 LINKED, 8 PENDING_REVIEW, 4 DROPPED
   Batch 2/2 (subject=math, total UNMATCHED=5): 5 hints → 2 LINKED, 2 PENDING_REVIEW, 1 DROPPED
   ```

### §4.2 LLM I/O schema（matchId 对齐）

**输入：**

```ts
{
  subjectId: string,
  candidates: Array<{
    id: string,         // kpId
    code: string,
    name: string,
    description: string | null,
    parentPath: string, // "数学 / 代数 / 一元一次方程"
  }>,
  hints: Array<{
    matchId: string,         // KpReconcileMatch.id
    rawHint: string,
    normalizedHint: string,
  }>,
}
```

**输出（zod-validated）：**

```ts
z.array(z.object({
  matchId: z.string().cuid(),               // 用于写回；不靠 rawHint 对齐（LLM 可能改写、批内重复）
  kpId: z.string().cuid().nullable(),       // null = NO_MATCH
  confidence: z.number().min(0).max(1),     // NO_MATCH 时也要给 0；要求 LLM 一定填
}))
```

**Prompt 模板：** `packages/ai/src/prompts/kp-reconciliation/v1.md`。要点：
- 显式给 KP 候选集 + 父子层级
- 要求 LLM 优先返已知 kpId，"宁缺勿滥"，不确定 → kpId=null
- 输出 JSON 数组、matchId 必须与输入一一对应

**返回结果对齐：** 写回时按 matchId 严格匹配（不靠 rawHint）。LLM 漏返或重复返 matchId → 走 retry 2 次（沿用 Plan 4 错因分析同款防御）；仍异常 → 该批整批跳过、KpReconcileMatch 状态留 UNMATCHED、ModelCall.status=`PARSE_FAILED`。LLM 返回不在本批 matchId 集合里的额外条目 → 直接忽略，不算异常（保证 prompt 偶然漂移不卡住整批）。

### §4.3 状态机分流

按 §3.3 表，matchVia=LLM 分支统一应用。三档判定阈值写进 env：

```
KP_RECONCILE_AUTO_LINK_THRESHOLD=0.85   # ≥ 此值且 sourceRefType≠VARIANT_ITEM → LINKED
KP_RECONCILE_REVIEW_THRESHOLD=0.6        # ≥ 此值 → PENDING_REVIEW（LLM_CONFIDENCE_BAND）；< 此值 → DROPPED
```

env zod 校验：两值 0..1、auto-link > review。

### §4.4 ModelCall 落审计

每批一条 ModelCall row：
```
ModelCall {
  taskKind: "KP_RECONCILE",
  inputDigest: sha256(JSON.stringify(input)).slice(0, 32),
  inputJson: <full input>,
  outputJson: <LLM raw output>,
  status: SUCCESS | PARSE_FAILED | ADAPTER_ERROR | TIMEOUT,
  modelVersion, latencyMs, tokensIn, tokensOut, ...（沿用现有 ModelCall 字段）
}
```

本批所有 KpReconcileMatch.modelCallId 指向此 row。**不写 CreditLedger** —— Plan 9 是系统维护，不计用户 credit。

---

## §5 状态机 + CLI kp:review

### §5.1 状态转移图

```
                            ┌──────────────┐
   sync miss ──────────────▶│  UNMATCHED   │
                            └──────┬───────┘
                                   │ kp:reconcile-pending (LLM batch)
        ┌──────────────────────────┼─────────────────────────┐
        ▼                          ▼                         ▼
     LINKED                  PENDING_REVIEW              DROPPED
     (写 QuestionKPLink)      (kpId=推荐值,             (kpId=null,
                              reviewReason 填)           留 ModelCall audit)
        ▲                          │
        │ kp:review                │ kp:review
        │                          ▼
        └──────────────────── a / m / alias
                                   │
                                   ▼ r
                                REJECTED
                                (kpId=拒绝的推荐, 保留 audit)

  sync EXACT/ALIAS 命中:
    sourceRefType ∈ {ERROR_BOOK_ENTRY, QUESTION} → 直接 LINKED + 写 QuestionKPLink
    sourceRefType = VARIANT_ITEM                  → 直接 PENDING_REVIEW
                                                    (reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW)
```

**kpId 字段三态语义：**
- UNMATCHED：kpId=null（无候选）
- LINKED / PENDING_REVIEW：kpId=推荐/已采纳值（CLI 直接读它显示）
- REJECTED：kpId=被拒的推荐（保留 audit）
- DROPPED：kpId=null（LLM 没给）

### §5.2 CLI 交互

```
$ pnpm.cmd --filter @zhijiao/web kp:review
Loading PENDING_REVIEW... 12 entries.

[1/12]  reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW
  Hint:        "二元一次方程组"
  Source:      VARIANT_ITEM  refId=cmpkpa3...  (variantItem L2)
  Suggested:   math-g8-system-eq  "二元一次方程组"  via ALIAS  confidence=1.00
  Parent question: cmpklj7c... "解方程组 { 2x+y=5; x-y=1 }"

Action [a/r/m <code>/alias <code>/s/q]> a
✓ LINKED. Wrote QuestionKPLink(cmpklj7c..., math-g8-system-eq, weight=1.00).

[2/12]  reviewReason=LLM_CONFIDENCE_BAND
  Hint:        "等量代换"
  Source:      ERROR_ANALYSIS  refId=cmpkmh2... (errorBookEntry)
  Suggested:   math-g7-substitution  "代入消元" via LLM  confidence=0.72

Action> alias math-g7-substitution
✓ LINKED via MANUAL. Wrote KpAlias(math, math-g7-substitution, "等量代换", source=CLI_MANUAL).
✓ QuestionKPLink upserted, weight=1.00.

[3/12]  ...
Action> q
Reviewed 2 / queued 12. Run again to continue.
```

### §5.3 service layer 接口

`apps/web/server/lib/kp-reconcile.ts` export 6 个函数：

```ts
// sync 主入口
export async function reconcileHintsSync(prisma, args): Promise<{ linked: number; queued: number; alreadySeen: number }>;

// CLI 行为映射
export async function approveMatch(prisma, args: { matchId: string; reviewedByUserId: string }): Promise<KpReconcileMatch>;
export async function rejectMatch(prisma, args: { matchId: string; reviewedByUserId: string }): Promise<KpReconcileMatch>;
export async function remapMatch(prisma, args: { matchId: string; newKpCode: string; reviewedByUserId: string }): Promise<KpReconcileMatch>;
export async function learnAliasAndLink(prisma, args: { matchId: string; targetKpCode: string; reviewedByUserId: string }): Promise<KpReconcileMatch>;

// LINKED → REJECTED 反悔时调用（Plan 9 不暴露 user-facing 入口，只 helper）
export async function unlinkIfOrphan(prisma, args: { questionId: string; kpId: string }): Promise<{ removed: boolean }>;
```

CLI 是 thin wrapper，全部业务逻辑在 service。未来 `/ops/kp-reconcile` Web 页面可直接复用。

### §5.4 alias 冲突防御

`learnAliasAndLink` 落 KpAlias 之前先查同 `(subjectId, normalizedAlias)` 是否已映射到其它 kpId：

```ts
const existing = await prisma.kpAlias.findUnique({
  where: { subjectId_normalizedAlias: { subjectId, normalizedAlias } },
});
if (existing && existing.kpId !== targetKpId) {
  throw new KpAliasConflictError({ existing, requested: targetKpId });
}
```

CLI 捕获 → 显示冲突详情 + 提示：
```
✗ Alias conflict: "等量代换" already maps to math-g7-other-kp (SEED).
  Plan 9 不提供 alias 覆盖入口；若必须改：
    1) 用 prisma studio 删旧 KpAlias 行；或
    2) 写 ad-hoc 脚本（不在 Plan 9 范围）。
  当前选项：`r` 拒绝本条 match 不学 alias / `m <kpCode>` 改 kpId 不学 alias / `s` 跳过。
Action [a/r/m <code>/alias <code>/s/q]>
```

**Plan 9 不实现 alias 删除/覆盖入口**（避免误操作）—— 错误消息只指向手动路径。Service 层测试守门冲突检测分支（断言抛 `KpAliasConflictError` 而非静默覆盖）。

### §5.5 LINKED → REJECTED 反悔规则（守 helper，不暴露 CLI 操作）

同一对 `(questionId, kpId)` 可能被多条 KpReconcileMatch 同时 LINKED（多人 diagnose 同 PUBLISHED 题命中同 KP）。删 QuestionKPLink 必须看是否还有"endorsing" match：

```ts
// unlinkIfOrphan 实现
const stillLinked = await prisma.kpReconcileMatch.count({
  where: { questionId, kpId, status: "LINKED" },
});
if (stillLinked === 0) {
  await prisma.questionKPLink.deleteMany({ where: { questionId, kpId } });
  return { removed: true };
}
return { removed: false };
```

**Plan 9 不暴露此操作给 CLI / router** —— 只 export helper、写 unit 测，未来真有批量误匹配修正需求再开独立脚本。

---

## §6 Router 接入点

三处 mutation body 加 reconcileHintsSync 调用（**业务写入成功后，await + try/catch**）：

### §6.1 tutor.ask

```ts
// apps/web/server/routers/tutor.ts （Plan 8 已落地的 body 上扩展）
.mutation(async ({ ctx, input }) => {
  // ... AI 调用 + upsertUserAdhocQuestion 不变 ...
  const question = await upsertUserAdhocQuestion(ctx.db, { ... });

  try {
    await reconcileHintsSync(ctx.db, {
      questionId: question.id,
      hints: ai.knowledgePoints,
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: question.id,
    });
  } catch (e) {
    logger.warn({ event: "kp_reconcile_sync_failed", source: "TUTOR_ADHOC", questionId: question.id, err: String(e) });
  }

  return { ...ai, questionId: question.id };
})
```

### §6.2 error.diagnose

```ts
// apps/web/server/routers/error.ts （Plan 4/8 已落地的 body 上扩展）
const entry = await ctx.db.$transaction((tx) =>
  upsertEntryOnDiagnose(tx, { ... }),
);

try {
  await reconcileHintsSync(ctx.db, {
    questionId: input.questionId,
    hints: ai.suggestedKnowledgePoints,
    source: "ERROR_ANALYSIS",
    sourceRefType: "ERROR_BOOK_ENTRY",
    sourceRefId: entry.id,   // 注意：不是 diagnoseLedgerId
  });
} catch (e) {
  logger.warn({ event: "kp_reconcile_sync_failed", source: "ERROR_ANALYSIS", entryId: entry.id, err: String(e) });
}

return { entryId: entry.id, ... };
```

### §6.3 variant.generateForEntry

```ts
// apps/web/server/routers/variant.ts
// VariantGroup + VariantItems 落库后
for (const item of createdItems) {
  try {
    await reconcileHintsSync(ctx.db, {
      questionId: entry.questionId,
      hints: item.knowledgePointHints,
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: item.id,
    });
  } catch (e) {
    logger.warn({ event: "kp_reconcile_sync_failed", source: "VARIANT_ITEM", variantItemId: item.id, err: String(e) });
  }
}
```

---

## §7 Backfill + Seed

### §7.1 KpAlias 初始 seed

`packages/db/prisma/seed/2_kp_aliases.ts`：8–12 条手工策展，仅覆盖当前 seed 里的 4 个 math KP，每个 KP 2–3 条**高确定**别名（中英文均可、空格/语序变体）。

例：
```ts
const aliases = [
  { subjectCode: "math", kpCode: "math-g7-linear-eq",
    aliases: ["一元一次方程", "linear equation", "一元一次"] },
  { subjectCode: "math", kpCode: "math-g8-system-eq",
    aliases: ["二元一次方程组", "system of equations"] },
  // ... 另两个 KP 各 2-3 条
];
for (const a of aliases) {
  const subject = await prisma.subject.findUniqueOrThrow({ where: { code: a.subjectCode } });
  const kp = await prisma.knowledgePoint.findUniqueOrThrow({
    where: { subjectId_code: { subjectId: subject.id, code: a.kpCode } },
  });
  for (const raw of a.aliases) {
    await prisma.kpAlias.upsert({
      where: { subjectId_normalizedAlias: { subjectId: subject.id, normalizedAlias: normalizeKpHint(raw) } },
      create: { subjectId: subject.id, kpId: kp.id, normalizedAlias: normalizeKpHint(raw), source: "SEED" },
      update: {},  // 幂等
    });
  }
}
```

不扩到 50–100 条 —— alias 质量比数量重要，乱塞同义词会误自动匹配。CLI `alias <code>` 慢慢沉淀。

### §7.2 一次性 backfill 脚本

`apps/web/scripts/kp-backfill-variant-items.ts`：

```ts
// 扫所有 VariantItem 行（按 createdAt asc, take:200 分批避免大表 OOM）
// 对每行：
//   await reconcileHintsSync(prisma, {
//     questionId: variantItem.group.entry.questionId,
//     hints: variantItem.knowledgePointHints,
//     source: "BACKFILL",
//     sourceRefType: "VARIANT_ITEM",
//     sourceRefId: variantItem.id,
//   });
//
// 幂等：靠 KpReconcileMatch @@unique([sourceRefType, sourceRefId, normalizedHint])
// 重跑安全，alreadySeen 计数累计
```

**BACKFILL + sourceRefType=VARIANT_ITEM 仍走 §3.3 表 VARIANT_ITEM 行**，命中 exact/alias 也只到 PENDING_REVIEW（reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW），不自动写 parent QuestionKPLink。

### §7.3 收尾运行顺序

Plan 9 merge 后必跑一次（写进 plan §"完成条件" + CLAUDE.md "Merge 后必跑"）：

```powershell
pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts
pnpm.cmd --filter @zhijiao/web kp:reconcile-pending           # 处理 UNMATCHED → LINKED/PENDING/DROPPED
pnpm.cmd --filter @zhijiao/web kp:review                       # 人工把 PENDING_REVIEW 清完
```

**不进 app boot / migration / cron**。

---

## §8 测试矩阵

| 测试位置 | 文件 | 覆盖 |
|---|---|---|
| `packages/ai/tests/` | `kp-reconciliation.test.ts` | LLM prompt + zod schema 解析 / NO_MATCH / matchId 对齐 / retry-on-parse-fail / 漏返 matchId / 多返 matchId |
| `apps/web/tests/unit/` | `kp-reconcile-lib.test.ts` | normalizeKpHint / KP-map 构造 / alias map 构造 / unlinkIfOrphan orphan 判定（无 LINKED → 删；有 LINKED → 不删） |
| `apps/web/tests/integration/` | `kp-reconcile-sync-tutor-ask.test.ts` | tutor.ask body 命中 exact/alias → LINKED + QuestionKPLink；命中 miss → UNMATCHED；reconcile 失败不阻塞 tutor.ask（mock 抛错） |
| 同上 | `kp-reconcile-sync-error-diagnose.test.ts` | 同上 for error.diagnose；sourceRefId 是 entry.id 不是 diagnoseLedgerId（专门 assert） |
| 同上 | `kp-reconcile-sync-variant.test.ts` | **VARIANT_ITEM EXACT/ALIAS 命中走 PENDING_REVIEW，不写 QuestionKPLink**（§3.3 关键守门） |
| 同上 | `kp-reconcile-state-machine.test.ts` | UNMATCHED→LINKED / UNMATCHED→PENDING_REVIEW / UNMATCHED→DROPPED / PENDING_REVIEW→LINKED (approve) / PENDING_REVIEW→REJECTED / PENDING_REVIEW→LINKED with new kpId (remap) / alias 学到 KpAlias |
| 同上 | `kp-reconcile-alias-conflict.test.ts` | learnAliasAndLink 检测 (subjectId, normalizedAlias) 已映射到其它 kpId → 抛 KpAliasConflictError，不覆盖 |
| 同上 | `kp-reconcile-backfill.test.ts` | backfill 脚本对已有 VariantItem：1) 不污染 parent；2) 幂等重跑 0 新 row |
| 同上 | `kp-reconcile-subject-isolation.test.ts` | math hint 不会匹到 english KP / english alias（防御 cross-subject 错配） |

LLM mock：沿用 Plan 4 `MockAiRouter` 模式，加 `kpReconcile(input)` 方法，测试 `vi.mock("@/lib/ai-client")` 注入确定性响应（命中 / NO_MATCH / 解析失败 / 漏返 matchId 等场景）。

CLI script 本体（`kp-review.ts` / `kp-reconcile-pending.ts`）：覆盖 service 层集成测试足够；CLI 交互层手测，不上自动化（Plan 4 E2E 工艺类比）。

---

## §9 Merge 后必跑探针（30-34）

30. **KpAlias subject 隔离 unique idx 落库**：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d kp_aliases"` 应见 `UNIQUE (subject_id, normalized_alias)`。同 alias 跨 subject 允许，同 subject 内唯一
31. **三个 sync 调用点都包 try/catch**：`Select-String -Path apps/web/server/routers/tutor.ts,apps/web/server/routers/error.ts,apps/web/server/routers/variant.ts -Pattern "reconcileHintsSync" -Context 2,5` 每处必须出现在 `try { ... } catch` 块内 + `logger.warn` 兜底。reconcile 失败必须不破坏主流程
32. **sourceRefType=VARIANT_ITEM 永不写 QuestionKPLink**：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts` 应全绿。grep service 层 `reconcileHintsSync` body 中"写 QuestionKPLink"分支必须有 `if (sourceRefType !== "VARIANT_ITEM")` 守门
33. **LINKED→REJECTED 反悔入口未暴露**：`grep -rn "unlinkIfOrphan" apps/web/server/routers apps/web/scripts` 应 0 命中（unit test 可 import 它走 helper，不算"用户入口"）。Plan 9 只 export helper + 文档化清理 SQL；未来开放再改
34. **backfill 脚本幂等**：连跑两次 `tsx scripts/kp-backfill-variant-items.ts`，断言 `prisma.kpReconcileMatch.count({ where: { source: "BACKFILL" } })` 第二次和第一次相等

---

## §10 已知风险 + 设计代价

### §10.1 初期 KP 树稀疏 → UNMATCHED → DROPPED 比例高

当前 math 只 4 个 KP，绝大多数 hint 会落 UNMATCHED → LLM → DROPPED。Plan 9 上线一段时间内：
- KpReconcileMatch DROPPED 行会快速增多 → ModelCall 留 audit，但没数据价值
- alias 表长得慢
- 学情画像 / 教师分层作业（消费端）的 QuestionKPLink 覆盖率低

**设计代价：** Plan 9 不做"硬塞匹配"补偿（lowerthreshold / fuzzy match / 翻译式）。理由：低质量自动匹配会污染权威 QuestionKPLink，影响后续 Plan 10/11 数据。等 KP 树扩充（独立 plan）后会自然好转。

### §10.2 LLM cost 不计 credit，但是真钱

`kp:reconcile-pending` 手动跑，每批默认 50 条。如果连跑多批，单次操作能烧十几次 LLM call。

**缓解：**
- CLI 默认 50 条 + `--limit N` flag 调小
- CLAUDE.md 指引"积累到 ≥50 UNMATCHED 再跑"
- ModelCall 记录 tokensIn/tokensOut，便于事后 cost 复盘
- Plan 9 不接 cron（避免成本不可见）

### §10.3 VariantItem PENDING_REVIEW 堆积速度

每次 `variant.generateForEntry` 出 ≤30 hint（3 item × ≤10 hint），全部进 PENDING_REVIEW。OPS（= 单人 dev）需保持 `kp:review` 节奏。

**缓解：** Plan 9 验收期内自己评估 review 频率，如果太频繁，下个 plan 考虑"VariantItem 升格成独立 Question"路径，hints 落到 variant 自己的 Question.knowledgePoints，不再骚扰 parent question。

### §10.4 ModelCall.taskKind 是 String 不是 enum

老问题：所有 taskKind 写字面值，typo 风险。Plan 9 加 `"KP_RECONCILE"` 字面值时显式 `as const` + grep audit；未来全局 taskKind enum 化是独立 plan。

### §10.5 反向清理 unlinkIfOrphan 不上 CLI

Plan 9 不暴露 LINKED → REJECTED 入口。如果未来发现某 KP 在批量 LINKED 后才意识到错（比如 alias 写错了），需要手动写 ad-hoc 脚本修。

**缓解：** alias 冲突防御 (§5.4) 阻止覆盖；kp:review 落 alias 前先 grep 现状是默认习惯；如果真出事，独立 plan 开"批量反悔脚本"。

---

## §A 附录：与 Plan 4 / Plan 8 工艺一致性

| 工艺 | 来源 | Plan 9 沿用 |
|---|---|---|
| middleware 显式 chain 顺序（validate 在 charge 前）| Plan 4 §4.2 / Plan 8 §3.1 | N/A（Plan 9 不引入新 middleware；reconcile 在 mutation body 内） |
| `chargeMiddleware(kind)` factory | Plan 4 Task 3 | N/A（Plan 9 不计费） |
| `migrate dev --create-only` → raw SQL → `migrate dev` | Plan 4 / Plan 8 Task 1 | 简化：本 plan 不需要 raw SQL partial idx，直接 `migrate dev`（§2.4） |
| P2002 catch → 重读 / no-op | Plan 8 `upsertUserAdhocQuestion` | 一致（§3.4.1） |
| `pnpm.cmd`（PowerShell execution policy）| Plan 4 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 红线 #16 | 一致（每个 task commit 前 grep） |
| `next build` 是 UI task 的 commit prereq | Plan 4 Task 6 followup | N/A（Plan 9 无 UI 改动） |
| 测试 fixture 用户每个有 100 credits | Plan 3 seed | N/A（Plan 9 不计费），但既有 fixture 保留 |
| 每个 task 一个 commit + 引用 task 编号 | Plan 4 红线 #14 | 一致 |
| Spec 是真理来源 + plan 引用章节号 | Plan 8 / Plan 4 | 一致 |
| 收尾走 `zhijiao-merge-workflow`（无 GitHub remote）| Plan 4 Task 8 | 一致 |
| OPS 操作走 CLI 不走 Web | Plan 9 新工艺（memory [[zhijiao-single-dev-no-ops-ui]]） | 本 plan 引入 |

---

## §B 附录：reconciler 调用图

```
                ┌─────────────────────────────┐
                │ tutor.ask (sync)            │
                │  source=TUTOR_ADHOC          │──┐
                │  sourceRefType=QUESTION      │  │
                └─────────────────────────────┘  │
                ┌─────────────────────────────┐  │
                │ error.diagnose (sync)        │  │
                │  source=ERROR_ANALYSIS       │──┤
                │  sourceRefType=ERROR_BOOK    │  │
                └─────────────────────────────┘  │
                ┌─────────────────────────────┐  │
                │ variant.generateForEntry     │  │
                │  source=VARIANT_ITEM          │──┼─▶ reconcileHintsSync()
                │  sourceRefType=VARIANT_ITEM   │  │     │
                └─────────────────────────────┘  │     ├─▶ EXACT / ALIAS 内存查 → 命中 → 状态机分流 → 写 KpReconcileMatch (+ 视情况 QuestionKPLink)
                ┌─────────────────────────────┐  │     │
                │ kp-backfill-variant-items     │  │     └─▶ 未命中 → 写 KpReconcileMatch(UNMATCHED)
                │ (one-shot CLI)                │──┘
                │  source=BACKFILL              │
                │  sourceRefType=VARIANT_ITEM   │
                └─────────────────────────────┘

                ┌─────────────────────────────┐
                │ kp:reconcile-pending (CLI)    │── 取 UNMATCHED → LLM batch (matchId 对齐)
                │                               │     │
                │                               │     ├─▶ ≥0.85 且 ≠VARIANT_ITEM → LINKED + QuestionKPLink
                │                               │     ├─▶ ≥0.85 且 VARIANT_ITEM   → PENDING_REVIEW
                │                               │     ├─▶ 0.6-0.85               → PENDING_REVIEW
                │                               │     └─▶ <0.6 / NO_MATCH        → DROPPED
                │                               │   + ModelCall(taskKind=KP_RECONCILE)
                └─────────────────────────────┘

                ┌─────────────────────────────┐
                │ kp:review (CLI 交互)          │── PENDING_REVIEW 单键操作
                │                               │     │
                │                               │     ├─▶ a    → LINKED + QuestionKPLink (weight=row.confidence, max with existing)
                │                               │     ├─▶ r    → REJECTED
                │                               │     ├─▶ m    → LINKED (kpId 换) + QuestionKPLink
                │                               │     ├─▶ alias→ LINKED + QuestionKPLink + KpAlias
                │                               │     └─▶ s/q  → skip/quit
                └─────────────────────────────┘
```
