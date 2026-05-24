# 智教 · Plan 8 答疑题面持久化 + ErrorAnalysisCard 接入答疑闭环 Design

> Spec 是 Plan 8 的真理来源；实现 plan 引用本 spec 章节号。

## §1 目标 + 范围 + 显式 punt

**目标：** 把 Plan 4 留的 ErrorAnalysisCard 真正挂进答疑流程。学生在 `/tutor` 输入题面 → AI 讲解 → 一键"加入错题本并分析错因" → 跳 `/error-book/[entryId]` 闭合学生学习中心主链路（CLAUDE.md "## 一句话产品定位"）。

**范围（本 plan 做）：**

- `Question` schema 加 2 字段（`createdByUserId` / `normalizedStemHash`）+ partial unique idx；`User.createdQuestions[]` 反向关联
- `tutor.ask` middleware 链改造：插 `validateTutorInputCompliance` 在 `chargeMiddleware("TUTOR_ASK")` 之前；body 改造：AI 成功后 upsert USER_ADHOC `Question` + 返 `questionId`
- `apps/web/server/lib/question.ts` 新建：`normalizeStem` / `stemHashHex` / `upsertUserAdhocQuestion` / `QUESTION_SOURCE_USER_ADHOC` 常量
- `apps/web/components/TutorForm.tsx` 改造：加可选 "我的作答（可选）" 折叠输入区；讲解出来后 mount `ErrorAnalysisCard` 传 `questionId` + actualAnswer 快照
- 测试：unit (normalize/hash) + integration (questionid/dedup/compliance/race/published-untouched/stem-too-long) + E2E (tutor→错题本闭环)
- seed 加 `13800000006` 学生 fixture
- CLAUDE.md 更新

**显式 punt（写进本 spec §6 + plan §"不做"清单）：**

- USER_ADHOC 题 GC（孤儿清理 / 注销时去标识化）→ Plan 6 PII 治理
- PII 扫描（手机号 / 身份证 regex）→ Plan 6
- 图片题（OCR / image upload）→ 独立 plan
- 教师或学生从题库选题流程 → 独立 plan
- 自动判对错（AI 比对学生作答正确性）→ 独立 plan
- 知识点 hint → KP id 映射（Plan 4 `knowledgePointHints` 落库到 USER_ADHOC 题的 `QuestionKPLink`）→ Plan 9 KP reconciler
- **PUBLISHED 题复用**：用户输完一道完全等同于题库 PUBLISHED 题的题，本 plan **不复用** PUBLISHED 行，建新 USER_ADHOC 副本。代价：班级题库统计无法覆盖 ad-hoc 副本，错题本关联 USER_ADHOC 而非 PUBLISHED。punt 给"题库去重 / PUBLISHED 复用 / 统计归并"独立 plan。理由：复用 PUBLISHED 引入多新决策（怎么判"完全相同"——stem hash 还是 + subject/type/difficulty；学生输入含错别字/换行算同题吗；统计归并语义；PUBLISHED 有标准答案而 USER_ADHOC 没有，diagnose 行为不同），偏离 Plan 8 目标

## §2 Schema 变更

### §2.1 `Question` 加 2 字段

```prisma
model Question {
  // ...现有字段保留...
  source              String?  // 现有；本 plan 起用值 "USER_ADHOC"
  createdByUserId     String?  @map("created_by_user_id")     // 新：nullable
  normalizedStemHash  String?  @map("normalized_stem_hash")   // 新：nullable

  createdBy           User?    @relation("CreatedQuestions", fields: [createdByUserId], references: [id], onDelete: SetNull)
  // 现有 errorBookEntries / answer / knowledgePoints 关联不变
}

model User {
  // ...现有...
  createdQuestions    Question[]  @relation("CreatedQuestions")
}
```

### §2.2 `source` 字段策略

- 沿用现有 `Question.source: String?`（不加 enum）；常量定义在 `apps/web/server/lib/question.ts`：

```ts
export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";
```

- 未来 sources 多了再升级 enum；当前一处 grep 友好

### §2.3 `onDelete: SetNull` 边界（与 Plan 4 `ErrorBookEntry → Question @restrict` 业务含义差异）

- `Question.createdByUserId @SetNull` —— 归属元数据，用户注销时可抹（必要：Plan 6 PII 治理要支持用户注销动作；用 Restrict 会让注销硬失败）
- `ErrorBookEntry.questionId @Restrict`（Plan 4 沿用）—— 审计主链路，不能因题目被删就断
- 用户注销后效果：
  - 该用户的 ad-hoc Question 行保留，`createdByUserId` 置 NULL
  - 历史错题（ErrorBookEntry 引用 questionId）仍能展示题面
  - 真正的 PII 删除 / 匿名化由 Plan 6 决定（如把 stem 也匿名化 / 标记 tombstone）

### §2.4 Partial unique index（migration 末尾 raw SQL 追加，Plan 4 同手艺）

```sql
CREATE UNIQUE INDEX questions_user_adhoc_dedup_idx
  ON questions (created_by_user_id, normalized_stem_hash)
  WHERE source = 'USER_ADHOC'
    AND created_by_user_id IS NOT NULL
    AND normalized_stem_hash IS NOT NULL;
```

- 只约束 USER_ADHOC 题；SEED/PUBLISHED 不在 WHERE 内
- 显式 `IS NOT NULL` 守门：避免脏数据 / 注销后行进入索引语义混乱

### §2.5 Migration 顺序（沿用 Plan 4 Task 1 工艺）

1. `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan8_user_adhoc_question`
2. 手动追加 §2.4 raw SQL 到生成的 migration.sql **末尾**
3. `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev` apply（一次性把含 partial idx 的完整 SQL 落库 + 写 checksum，无 drift）

## §3 `tutor.ask` middleware 链 + body 流程

### §3.1 Middleware 链

```ts
export const tutorRouter = router({
  ask: authedProcedure
    .use(validateTutorInputCompliance)         // 新：扣费前扫违禁词
    .use(chargeMiddleware("TUTOR_ASK"))        // 沿用 Plan 4 抽出的 factory（不是 chargedProcedure 糖语法）
    .input(TutorAskInputSchema)
    .mutation(async ({ ctx, input }) => { ... }),
});
```

- `chargedProcedure("TUTOR_ASK")` 糖语法保留（error/variant 路由不影响）；`tutor.ask` 自身改用 explicit chain 因为要插 middleware 在 charge 之前
- Plan 4 Task 3 抽出的 `chargeMiddleware` factory + 糖语法二者并存的设计在此处兑现价值

### §3.2 `validateTutorInputCompliance` middleware

落在 `apps/web/server/trpc.ts`，参照 `validateEntryOwnership` 写法：

```ts
export const validateTutorInputCompliance = t.middleware(async ({ next, getRawInput }) => {
  const raw = (await getRawInput()) as { questionStem?: unknown } | undefined;
  const stem = typeof raw?.questionStem === "string" ? raw.questionStem : "";
  // 边界处理：
  //   非 string / 空 string / 超长 → 不扫，让 zod 后续抛常规 BAD_REQUEST
  //   合法长度 → 扫 findForbidden
  // 这避免：(a) 扫超大文本浪费 CPU；(b) 把 zod 兜底语义混进合规分支
  if (stem.length === 0 || stem.length > 4000) return next();
  const hits = findForbidden(stem);
  if (hits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "题目内容未通过安全检查，请修改后再试。",
      cause: { reason: "INPUT_COMPLIANCE_REJECTED", hits },
    });
  }
  return next();
});
```

- `findForbidden` 复用 Plan 4 `packages/ai/src/safety/forbidden.ts` 既有 helper
- 抛 `BAD_REQUEST` 在 `chargeMiddleware` 之前 → 不扣费、不写 Question、不调 AI

### §3.3 Mutation body 改造

```ts
.mutation(async ({ ctx, input }) => {
  const { clientRequestId: _cri, ...aiInput } = input;
  let ai;
  try {
    ai = await getAiRouter(ctx.auth.userId).tutor(aiInput);
  } catch (e) {
    if (e instanceof ComplianceRejectedError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
        cause: { reason: "COMPLIANCE_REJECTED", original: e },
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "讲解失败，请稍后再试。",
      cause: { reason: "TUTOR_INTERNAL" },
    });
  }
  // AI 成功才落 Question — 否则 chargeMiddleware 默认补偿，但 Question 已建会成孤儿
  const question = await ctx.db.$transaction(tx =>
    upsertUserAdhocQuestion(tx, { userId: ctx.auth.userId, stemMd: input.questionStem }),
  );
  return { ...ai, questionId: question.id };
}),
```

### §3.4 时序保证矩阵

| 场景 | 扣费 | Question | AI | Result |
|---|---|---|---|---|
| 违禁词命中 | 不扣 | 不写 | 不调 | `BAD_REQUEST / INPUT_COMPLIANCE_REJECTED` |
| AI 抛 `ComplianceRejectedError` | 扣 + 不补（白名单） | 不写 | 调 | `BAD_REQUEST / COMPLIANCE_REJECTED` |
| AI 抛其它 error | 扣 + 补偿 | 不写 | 调 | `INTERNAL_SERVER_ERROR / TUTOR_INTERNAL` |
| AI 成功 + Question upsert 失败 | 扣 + 补偿 | 不写（mini-transaction 回滚仅含 upsert；AI 调用在事务外，已发生不可回退）| 调 | INTERNAL_SERVER_ERROR；用户拿不到 questionId 但已扣费会被 chargeMiddleware fail-open 补偿 |
| AI 成功 + Question upsert 成功（race 含 P2002 重读） | 扣 | 写或复用赢家 | 调 | `{ ...ai, questionId }` |
| Idem hit（同 cri 重复打） | chargeMiddleware 抛 `CONFLICT / ACTION_IDEMPOTENCY_HIT`，**不**call body | 不写 | 不调 | `CONFLICT`；TutorForm 旋转 pendingReqId 下次重新提交 |

注：idem hit 时 chargeMiddleware **不**返回 cached result，而是抛 `ActionAlreadyChargedError` → `TRPCError CONFLICT`。这是现有 Plan 3 行为，本 plan 不改。

### §3.5 TaskKind 不变

- AI 调用仍是 `TUTOR_TURN` task；Question 持久化不走 AI router
- 不新增 TaskKind

## §4 `upsertUserAdhocQuestion` helper + normalize / hash

### §4.1 文件位置 + 公开 API

`apps/web/server/lib/question.ts`（新文件）

```ts
export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";

export function normalizeStem(stem: string): string;
export function stemHashHex(stem: string): string;
export async function upsertUserAdhocQuestion(
  tx: Prisma.TransactionClient,
  args: { userId: string; stemMd: string },
): Promise<Question>;
```

### §4.2 `normalizeStem`

```ts
export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, " ");
}
```

- **不** lowercase（数学文本大小写可有义：点 A vs 点 a / 变量 X vs x / 集合矩阵向量符号 / `sin x` vs `SIN x`）
- Plan 8 去重目标是"防膨胀"，**不**是"语义相似题合并"

### §4.3 `stemHashHex`

```ts
export function stemHashHex(stem: string): string {
  // 128-bit prefix is enough for dedup; keeps the indexed value compact.
  // This is not a privacy boundary.
  return crypto.createHash("sha256").update(normalizeStem(stem)).digest("hex").slice(0, 32);
}
```

### §4.4 `upsertUserAdhocQuestion`

```ts
export async function upsertUserAdhocQuestion(
  tx: Prisma.TransactionClient,
  args: { userId: string; stemMd: string },
): Promise<Question> {
  const normalizedStemHash = stemHashHex(args.stemMd);

  // findFirst 先查 —— 比 try-create-then-P2002 在常见命中场景下少一次写尝试 +
  // 不污染 DB error log。race 场景仍由下面 P2002 catch 兜底。
  const existing = await tx.question.findFirst({
    where: {
      createdByUserId: args.userId,
      source: QUESTION_SOURCE_USER_ADHOC,
      normalizedStemHash,
    },
  });
  if (existing) return existing;

  // subject lookup via code @unique（不缓存：test reset DB 会让缓存过期 id 失效）
  const math = await tx.subject.findUniqueOrThrow({
    where: { code: "math" },
    select: { id: true },
  });

  try {
    return await tx.question.create({
      data: {
        subjectId: math.id,
        stemMd: args.stemMd,
        type: "ESSAY",                       // USER_ADHOC 题型用户未指定，ESSAY 是最宽容兜底
        status: "DRAFT",
        source: QUESTION_SOURCE_USER_ADHOC,
        createdByUserId: args.userId,
        normalizedStemHash,
      },
    });
  } catch (e) {
    // P2002 fall-through：不依赖 meta.target 字面（Prisma 在 raw SQL partial unique 上
    // meta.target 行为版本不稳）。改为：P2002 → 重读 → 命中赢家返回 / 未命中原样抛。
    // 本 helper 的 create 只有 dedup partial unique idx 会触发 P2002，所以这样比依赖
    // meta.target 更抗版本差异（与 Plan 4 `isErrorBookPartialUniqueP2002` 不同手艺，
    // 是本 plan 主动改进）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await tx.question.findFirst({
        where: {
          createdByUserId: args.userId,
          source: QUESTION_SOURCE_USER_ADHOC,
          normalizedStemHash,
        },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
```

## §5 TutorForm UI 改造

### §5.1 State 设计

```ts
const [actualAnswer, setActualAnswer] = useState("");                    // 输入框 state，用户自由编辑
const [showActualAnswer, setShowActualAnswer] = useState(false);         // 折叠开关
const [diagnoseActualAnswer, setDiagnoseActualAnswer] = useState<string | undefined>();
                                                                          // 快照：本次讲解时的 actualAnswer，传给 ErrorAnalysisCard
// 类型从 tRPC infer（typeof `inferRouterOutputs<AppRouter>["tutor"]["ask"]`，
// import 路径 `@trpc/server` + `@/server/routers/_root`），必含 questionId。
// 不手写 `TutoringOutput & { questionId: string }` —— 后面 AI 输出字段变动时要双改。
const [data, setData] = useState<TutorAskResult | null>(null);
// 其中 TutorAskResult 在 TutorForm 顶部定义为：
//   type TutorAskResult = inferRouterOutputs<AppRouter>["tutor"]["ask"];
```

### §5.2 submit + onSuccess 行为

```ts
ask.onSuccess: (d) => {
  setData(d);
  setDiagnoseActualAnswer(actualAnswer.trim() || undefined);  // 快照绑定本次讲解
  // 不 clear actualAnswer —— 学生后续编辑输入框不影响已显示的讲解和错因分析
  setErr(null);
  setInsufficientBalance(false);
  setPendingReqId(null);
}
```

### §5.3 UI 布局（保留 slate-900 / emerald 配色 + 紧凑节奏）

```
[grade selector]
[题目 textarea]

▸ 我的作答（可选，能让错因分析更准确）   ← <details> 折叠
   [作答 textarea]

[讲一讲 button]
[err / 余额不足 → /wallet]

──── 讲解出来后 ────
[restatement h2]
[steps ul]
答案：...

──── ErrorAnalysisCard mount 在这里 ────
   questionId={data.questionId}
   actualAnswerMd={diagnoseActualAnswer}
```

### §5.4 ErrorAnalysisCard 不动

- Plan 4 Task 6.5 已建好（`apps/web/app/(student)/tutor/error-analysis-card.tsx`）
- Props 接口 `{ questionId, actualAnswerMd? }` 正好对得上 §5.1 state
- 文案保留："这道题做错了？" / "加入错题本并分析错因（1 credit）"
- 卡片职责保持单一：发起错因分析 + 显示结果 + 给 `/error-book/[entryId]` 链接；**不**管理 actualAnswer 输入

### §5.5 actualAnswer 在详情页可见

- error.diagnose 已经把 actualAnswerMd 落到 `ErrorBookEntry.actualAnswerMd`（Plan 4 现有行为）
- Plan 4 Task 6.2 `entry-detail.tsx` 已有 `<details>` "查看我当时的作答" 折叠区
- Plan 8 不动 entry-detail.tsx；E2E 验"详情页能看到刚才填的作答"是 Plan 4 已有 surface 的复用

## §6 兼容性 + 已知不做项

### §6.1 兼容性

- `chargedProcedure(kind)` 糖语法不动（error/variant 路由仍用，零行 diff）
- `chargeMiddleware(kind)` factory 复用，无新参数
- `error.diagnose / variant.generateForEntry` middleware 链顺序不变
- `Question.answer` 仍是 1:0..1 —— USER_ADHOC 不建 QuestionAnswer，`error.diagnose` 早已 handle null 标准答案
- 现有 PUBLISHED seed 题不受影响（`createdByUserId` / `normalizedStemHash` nullable；partial unique idx WHERE source='USER_ADHOC' 不约束）
- `TutorAskInputSchema` 不变（`questionStem` / `studentGrade` / `clientRequestId`）；`tutor.ask` 返回类型新增 `questionId: string`（向后兼容；既有 client 多个字段不破坏）

### §6.2 已知不做项（§1 punt 清单的细化）

- USER_ADHOC 题 GC：本 plan 不做 cron / TTL / 未引用清理。后续 Plan 6 设计统一保留期 + 注销时去标识化策略
- PII 扫描：本 plan 不做手机号 / 身份证 regex。Plan 6 统一设计 PII 边界
- PUBLISHED 复用：本 plan 不做。代价：班级题库统计无法覆盖 ad-hoc 副本；错题本于是关联 USER_ADHOC 而非 PUBLISHED。punt 给独立 plan
- 图片题 / OCR：本 plan 只接受 text stem；`stemImageKeys` 字段保留空数组
- 教师 / 学生从题库选题流程：本 plan 不加 UI 入口
- 自动判对错：本 plan 不调 AI 比对学生作答正确性

## §7 测试矩阵

### §7.1 Unit

- `packages/db/tests/...` 或 `apps/web/tests/unit/question-normalize.test.ts`：
  - `normalizeStem` trim + 空白折叠正确；大小写**不**变；含 emoji / 全角符号原样
  - `stemHashHex` 同输入产同 hash；不同输入产不同 hash；输出长度 32 hex

### §7.2 Integration（`apps/web/tests/integration/`）

- **`tutor-ask-questionid.test.ts`** —— happy：返回含 `questionId`；DB 多一行 `Question(source=USER_ADHOC, createdByUserId=user, status=DRAFT, type=ESSAY, normalizedStemHash≠null)`
- **`tutor-ask-dedup.test.ts`** —— 同 user 同 stem 调两次：返同 questionId，Question 表只 1 行；不同 user 同 stem：各建一行；同 user 仅空白差异 stem：仍返同 questionId（normalize 生效）
- **`tutor-ask-input-compliance.test.ts`** —— stem 含违禁词 → `BAD_REQUEST / INPUT_COMPLIANCE_REJECTED`；wallet 余额未减；CreditLedger 无 `kind=DEBIT actionKind=TUTOR_ASK` row；Question 表无新行
- **`tutor-ask-stem-too-long.test.ts`** —— stem.length > 4000 字符：中间件 `return next()`，zod 抛常规 `BAD_REQUEST`（**不**走 INPUT_COMPLIANCE_REJECTED 路径）。锁 §3.2 边界设计
- **`tutor-ask-race.test.ts`** —— 同 user 同 stem 两个并发 ask：两次都成功；Question 仍只 1 行（P2002 fall-through 重读赢家）；两次返同一 questionId
- **`tutor-ask-published-untouched.test.ts`** —— 已存在 PUBLISHED 题 stemMd 与用户输入完全相同：用户提交后建**新** USER_ADHOC 行（partial unique idx WHERE source='USER_ADHOC' 不影响 PUBLISHED）。锁 §6.2 设计代价

### §7.3 E2E（`apps/web/e2e/tutor-error-book-link.spec.ts`，新 spec）

PHONE = `13800000006`（Plan 8 新加学生 fixture；avoid tutor.spec=001 / error-book.spec=004 / wallet-topup 既有用户）

**主路径**：
1. 登录 → `/tutor`
2. 填题目 + 展开"我的作答（可选）"+ 填作答 → 点"讲一讲"
3. 看到讲解（restatement / steps / 答案）+ ErrorAnalysisCard
4. 点 ErrorAnalysisCard "加入错题本并分析错因（1 credit）"
5. 看到"查看错题详情 →"链接
6. 点链接 → 跳 `/error-book/[entryId]`
7. 详情页 `entry-detail` 可见 + `entry-reasoning` 可见
8. 展开"查看我当时的作答" `<details>` → 看到刚才填的 actualAnswer 内容

**无作答路径**：
1. 同上 1-2 但不填作答（不展开折叠区）
2. 同上 3-7
3. **不**断言详情页"查看我当时的作答"区块（actualAnswerMd undefined 时 entry-detail.tsx 不渲染此 details）

**E2E 不断言**：reasoning 文本"含来自 actualAnswer 的内容感知"——mock AI 不一定真把 actualAnswer 写进 reasoning；真实 AI 更不能用固定文案断言。E2E 验链路，不验模型语义。

### §7.4 seed 改动

`packages/db/prisma/seed/1_test_users.ts` 加：

```ts
{ id: "dev-student-02", phone: "13800000006", name: "测试学生 02", persona: Persona.STUDENT, gradeLevel: GradeLevel.G9, isMinor: false, roles: [] },
```

钱包初始 100 credits（沿用现有 fixture seed wallet 工艺）。

## §8 Plan 任务划分（给 writing-plans 参考）

建议 8 个 task：

- **Task 0**：仓库卫生（沿用 Plan 4 工艺，`.gitignore` 已 OK，主要确认无残留 worktree）
- **Task 1**：Prisma migration —— `Question` 2 字段 + partial unique idx + `User.createdQuestions` 关联 + `packages/db/prisma/seed/1_test_users.ts` 加 dev-student-02
- **Task 2**：`apps/web/server/lib/question.ts` —— `normalizeStem` / `stemHashHex` / `upsertUserAdhocQuestion` + unit tests
- **Task 3**：`apps/web/server/trpc.ts` —— `validateTutorInputCompliance` middleware
- **Task 4**：`apps/web/server/routers/tutor.ts` —— middleware 链改造 + body 改造 + 返 questionId；6 个 integration tests（§7.2）
- **Task 5**：`apps/web/components/TutorForm.tsx` —— "我的作答" 折叠 + snapshot state + ErrorAnalysisCard mount；手测 dev server
- **Task 6**：E2E `tutor-error-book-link.spec.ts`（§7.3）
- **Task 7**：全量回归 + CLAUDE.md 更新 + Merge 验收清单（沿用 Plan 4 Task 8 工艺）

### §8.1 CLAUDE.md 更新（Task 7）

- "## 开始实现时（已落地）" 加 Plan 8 条目
- "错题本 / 变式现状" 段后加 "**答疑题面持久化现状**（Plan 8）" 子段
- "Merge 后必跑" 加 4 条新探针：
  - 21. `tutor.ask` 输入扫描在扣费前（grep middleware 链顺序：`validateTutorInputCompliance` 必须在 `chargeMiddleware` 之前）
  - 22. USER_ADHOC 去重 partial unique idx 已落 DB（`docker exec ... \d questions` 见 `questions_user_adhoc_dedup_idx`）
  - 23. ErrorAnalysisCard 从 tutor 页能跳到 `/error-book/[entryId]`（E2E spec 名 `tutor-error-book-link.spec.ts`）
  - 24. PUBLISHED 题不被 USER_ADHOC 复用（spec §6.2 设计代价；integration `tutor-ask-published-untouched.test.ts` 守门）
- 候选 Plan：Plan 8 移走；Plan 6 子项注明"USER_ADHOC 题 GC / 注销时去标识化"关联 Plan 8

## §9 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| Question 的 `subject_id` 必填阻断 USER_ADHOC 写入 | Task 4 integration test `tutor-ask-questionid` 红 | 确认 `tx.subject.findUniqueOrThrow({ where: { code: "math" } })` 在 seed 后能查到；如 seed 顺序问题 → 看 `packages/db/prisma/seed/0_curriculum.ts` |
| partial unique idx 未落 per-pkg test DB | Task 1 步骤 grep `\d questions` 未命中 | 沿用 Plan 4 Task 1 步骤 1.10 — `pnpm.cmd test:setup` 重建 + 手验 raw SQL 已应用 |
| `validateTutorInputCompliance` 把 zod 兜底场景吃了 | Task 4 `tutor-ask-stem-too-long` red | 确认中间件 `if (stem.length === 0 || stem.length > 4000) return next()` 的 length 判断；让 zod 接管 |
| Idem hit 时 Question 被重复 upsert | Task 4 integration 反复打同 cri 后 Question 表多行 | 不该发生 —— chargeMiddleware idem hit 抛 CONFLICT，body 不执行。如果真发生 → 看 Plan 3 `chargeForAction` 是否被改 |
| TutorForm 类型 infer 失败 | Task 5 typecheck 红 | 用 `NonNullable<RouterOutput["tutor"]["ask"]>` 或局部 result 类型；不手写 TutoringOutput & { questionId } |

## §10 附录：与 Plan 4 工艺一致性

| 工艺 | Plan 4 来源 | Plan 8 沿用 |
|---|---|---|
| middleware 显式 chain 顺序（validate 在 charge 前）| Plan 4 §4.2 `variant.generateForEntry` | 一致（§3.1）|
| `chargeMiddleware(kind)` factory + `chargedProcedure(kind)` 糖语法二者并存 | Plan 4 Task 3 | 一致（§3.1）；本 plan 兑现 factory 价值 |
| migrate dev --create-only → 追加 raw SQL → migrate dev | Plan 4 Task 1 步骤 1.6-1.8 | 一致（§2.5）|
| partial unique idx raw SQL + `IS NOT NULL` 守门 | Plan 4 §3.3 | 加强（本 plan §2.4 显式排除 NULL）|
| P2002 fall-through | Plan 4 `isErrorBookPartialUniqueP2002`（依赖 meta.target 字面）| **改进**（§4.4 改为 P2002 → 重读 → 命中返回 / 未命中抛，不依赖 meta.target，更抗 Prisma 版本差异）|
| Task 顺序：schema → helper → middleware → router → UI → E2E → 文档 | Plan 4 Task 1-8 | 一致（§8）|
| 每个 task 一个 commit | Plan 4 红线 #14 | 一致 |
| `pnpm.cmd` PowerShell execution policy | Plan 4 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 红线 #16 | 一致 |
| 测试 fixture 用户钱包初始 100 credits | Plan 3 seed 工艺 | 一致（§7.4 dev-student-02）|
| `next build` prereq（Suspense + JSX 引号转义）| Plan 4 Task 6 followup | 一致 — UI task 完成后必跑 `next build` 不只 `tsc --noEmit`，本 plan §8 Task 5 步骤要写明 |
