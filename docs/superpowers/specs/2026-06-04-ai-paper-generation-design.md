# Plan 17：AI 出卷（独立练习卷生成）—— 设计文档

- 日期：2026-06-04
- 状态：待实现
- 背景：项目 2026-06-04 完全转向教师生产力产品（AI 出卷 + AI 课件）；学生端闭环冻结为维护态。
- 关联：Plan 10（教师作业 / `AssignmentItem` 快照范式 / `chargeVariableMiddleware`）、Plan 13（KP 树）、Plan 9（`reconcileHintsSync`）、Plan 3（计费 / 补偿）、Plan 6/12（owner-only 题归属 + PII）。
- 范围标识：教师产品支柱 1。支柱 2（Plan 18 AI 课件）另写 spec。

## 0. 采纳的修正（相对初版设计）

1. **不新增 AI taskKind**：复用现有 `PAPER_GEN`（`packages/ai/src/tasks.ts` 已登记 → `qwen-max`；`packages/billing/src/pricing.ts` 价 5 credits；`packages/domain/src/rbac.ts` 已有 `PAPER_GEN`）。`PAPER_GEN` 表示**整套试卷生成**。
2. **固定计费**：v1 用 `chargedProcedure("PAPER_GEN")` 一次扣 **5 credits**，不做"按 AI 题数变量计费"。生成失败走现有补偿。变量计价/预估/删换题退费留后续。
3. **BANK 选题为可选增强，不作 v1 前置依赖**：题库语料（reshelved Plan 15）未落地、PUBLISHED 题量不足，故 v1 策略 = "有合适题就混入，没有就全 AI 生成"，**不被题库项目阻塞**。
4. **`PAPER_GENERATED` 纳入 owner-only 红线**：加入 `OWNER_ONLY_QUESTION_SOURCES`；只能教师本人经 Paper 访问，禁止他人通过 questionId 探测；PII 注销/导出覆盖此类题。
5. **`PaperItem` 保留 `rubricMd?` 与 `createdAt`**（仿 `AssignmentItem`，便于主观题/证明题评分标准 + 审计排序）。

## 1. 目标与范围

教师按 **年级 / 知识点 / 题型 / 难度 / 题量** 参数化生成一份**独立练习卷**（不绑班级、不走学生作答生命周期），带**答案解析**与**双向细目表**，可在线预览/编辑、用打印友好页导出（浏览器打印/另存 PDF）。

### in scope（v1）
- 新建独立 `Paper` / `PaperItem`，教师自有。
- `PaperItem` 存快照，支持 `BANK` / `AI_GENERATED` 双源。
- AI 生成题同时落 `Question(DRAFT, source="PAPER_GENERATED", createdByUserId=teacherId)` + reconcile KP。
- 固定 `PAPER_GEN` 计费（5 credits）。
- BANK 复用为可选增强，不阻塞全 AI 出卷。
- 双向细目表（KP × 能力 × 题型 × 难度 × 分值），渲染时计算。
- 打印页：题卷 → 答案解析 → 双向细目表。

### out of scope（v1）
- 服务端 Word/PDF 文件导出（打印页即导出路径）。
- AI 课件（Plan 18）。
- 学生分发 / 作答（Assignment 已覆盖；Plan 17 不接学生）。
- 变量计费 / 费用预估 / 删换题退费。
- 题库语料供给本身（独立 reshelved 工作；本 plan 仅在题库存在时择优混入）。

## 2. 数据模型

```prisma
enum CognitiveLevel { REMEMBER UNDERSTAND APPLY ANALYZE }   // 记忆 / 理解 / 应用 / 分析
enum PaperStatus { DRAFT READY }
enum PaperItemSource { BANK AI_GENERATED }

model Paper {
  id                 String      @id @default(cuid())
  teacherUserId      String      @map("teacher_user_id")
  subjectId          String      @map("subject_id")
  title              String
  status             PaperStatus @default(DRAFT)
  paramsJson         Json        @map("params_json")        // 年级/KP/题型/难度/题量 参数快照
  generationLedgerId String?     @map("generation_ledger_id")
  generationCallId   String?     @map("generation_call_id")
  createdAt          DateTime    @default(now()) @map("created_at")
  updatedAt          DateTime    @updatedAt @map("updated_at")

  teacher User        @relation("TeacherPapers", fields: [teacherUserId], references: [id], onDelete: Restrict)
  subject Subject     @relation(fields: [subjectId], references: [id])
  items   PaperItem[]

  @@index([teacherUserId, status, createdAt])
  @@map("papers")
}

model PaperItem {
  id             String          @id @default(cuid())
  paperId        String          @map("paper_id")
  position       Int
  questionId     String?         @map("question_id")        // BANK 复用 / AI 落 DRAFT 题
  source         PaperItemSource
  stemMd         String          @db.Text @map("stem_md")
  type           QuestionType
  optionsJson    Json?           @map("options_json")
  answerMd       String          @db.Text @map("answer_md")
  solutionMd     String          @db.Text @map("solution_md")
  rubricMd       String?         @db.Text @map("rubric_md")
  points         Int             @default(0)                 // 分值
  difficulty     Int             @default(3)
  cognitiveLevel CognitiveLevel  @map("cognitive_level")
  kpHints        String[]        @default([]) @map("kp_hints")
  createdAt      DateTime        @default(now()) @map("created_at")

  paper    Paper     @relation(fields: [paperId], references: [id], onDelete: Cascade)
  question Question? @relation(fields: [questionId], references: [id], onDelete: SetNull)

  @@unique([paperId, position])
  @@index([questionId])
  @@map("paper_items")
}
```

- `Question` 加 `cognitiveLevel CognitiveLevel?`（AI 生成时输出；题库题 seed 时可标注；旧题 null 不影响）。
- `Question` 加 relation `paperItems PaperItem[]`。

## 3. AI 生成（PAPER_GEN）

- 复用 `PAPER_GEN` taskKind（`qwen-max`）。**当前仅路由/价格登记，无生成方法**——本 plan 实现：
  - prompt 模板 `packages/ai/src/prompts/paper-gen/v1.md`：输入 `{grade}/{kpNames}/{typeDistribution}/{difficulty}/{count}`，输出 JSON：`{ title, items: [{ stemMd, type, optionsJson?, answerMd, solutionMd, rubricMd?, difficulty, cognitiveLevel, points, knowledgePointHints[] }] }`。合规：无提分/分数/通过/恐吓；只输出 JSON。
  - `PaperGenerationOutputSchema`（zod）+ `AiRouter.generatePaper(input)`（仿 `runJsonTaskWithAudit` 管线：PII 输出脱敏 + 违禁词扫 + parse 重试 2 次再 PARSE_FAILED + ModelCall 审计）。
  - mock 派发（`AI_USE_MOCK`）：关键词 → `DEFAULT_PAPER` 确定性输出，供测试与无 key 开发。

## 4. 生成流程（混合题源）

`paper.generate`（teacher-gated + `chargedProcedure("PAPER_GEN")`）：

1. 校验参数（年级/KP/题型分布/难度/题量；题量上限如 30）。
2. **BANK 选题（best-effort，可选）**：按 `status=PUBLISHED` + KP 命中 + 题型 + 难度 邻近，选不超过需求量的题（去重）。题库空/不足 → 选 0 道，不报错。
3. **AI 补缺口**：`gap = count - bankCount`；`gap > 0` 调 `PAPER_GEN` 生成 gap 道（prompt 带已选 BANK 题摘要避免重复）。`gap == 0` 跳过 AI（仍按固定 5 credits 计费，v1 简化）。
4. **事务落库**：`Paper(DRAFT)` + `PaperItem[]`（position 连续；BANK 题 `source=BANK, questionId=库题id`；AI 题先 `Question.create(DRAFT, source="PAPER_GENERATED", createdByUserId=teacherId, cognitiveLevel)` 再 `PaperItem(source=AI_GENERATED, questionId=新题id)`）。`generationLedgerId=ctx.debit.ledgerId`、`generationCallId=modelCallId`。
5. **reconcile**：对 AI 落的 Question 跑 `reconcileHintsSync`（事务外，await+try/catch 不破坏主流程，仿 `persistGeneratedAssignment`）。

计费在 resolver 前由 `chargedProcedure` 完成；AI 失败抛错 → 既有补偿退 5 credits（生成失败不落 Paper）。

## 5. 双向细目表

**渲染时计算，不单独存**：从 `Paper.items` 按 `KP × cognitiveLevel × 题型 × 难度` 聚合 → 每格题数 + 分值小计，行/列合计 + 总分。KP 维用 `kpHints`（或经 questionId 的 `QuestionKPLink`）。纯函数 `buildSpecTable(items)` 放 `apps/web/server/lib/paper-spec-table.ts`，单测覆盖。

## 6. 访问控制与 owner-only

- `paper.*` 教师门禁（persona=TEACHER，复用 assignment 路由门禁范式）。
- Paper/PaperItem 读写经 `validatePaperOwnership`（paper 不存在 / 跨教师 → 合并 `NOT_FOUND`，不区分存在性侧信道；注入 ctx.paper）。
- `source="PAPER_GENERATED"` 加入 `OWNER_ONLY_QUESTION_SOURCES`（`trpc.ts`）：经 `validateQuestionAccess` 的路由（如 `error.diagnose`）对他人的 PAPER_GENERATED 题返 `NOT_FOUND`，禁止 questionId 探测。教师只经 Paper 访问自己的题。

## 7. PII（扩 Plan 6/12）

- 注销教师：`deactivateUser` 删除其 `Paper`（级联 `PaperItem`）；其 `PAPER_GENERATED Question` 比照 `VARIANT_GENERATED` 处理——`createdByUserId=null` 保留行作统计样本（payload 只记计数）。
- 导出：`exportUserData` 含本人 `Paper` + `PaperItem` 白名单字段（stem/answer/solution/分值/难度/能力/题型/KP hints），不含他人数据。
- payload guard 禁词按需补 `paper_id`/`teacher_user_id` 等（若进 OpsActionLog 摘要）。

## 8. UI

- `/teacher/papers`：教师试卷列表（标题 / 题量 / 状态 / 时间）。
- `/teacher/papers/new`：参数表单（年级 / KP 多选 / 题型分布 / 难度 / 题量）→ 生成（AI 生成中面板 + 重试，复用 `ui/ai-generating-panel`）。
- `/teacher/papers/[id]`：预览（题目列表 + 答案解析折叠 + 双向细目表）；v1 支持删题 / 调分值（换题/重生成留后续）。
- `/teacher/papers/[id]/print`：打印友好页（`@media print`），题卷 → 答案解析分页 → 双向细目表。
- 教师导航/班级工作台把"AI 出卷"预览卡占位替换为真入口（`teacher/classes/[classroomId]/page.tsx` 现 `Plan 17` 占位段）。

## 9. 合规

- 无提分 / 分数 / 通过 / 恐吓文案；练习卷定位为教学工具。
- 双向细目表即透明度载体（KP / 能力 / 难度 / 分值公开）。
- AI 题与库题在预览/打印页标注来源（教师可核）。

## 10. Schema 变更汇总

1. 新枚举 `CognitiveLevel` / `PaperStatus` / `PaperItemSource`。
2. 新表 `Paper`、`PaperItem`。
3. `Question` 加 `cognitiveLevel CognitiveLevel?` + relation `paperItems`。
4. `User` 加 relation `papers Paper[]`（`TeacherPapers`）。
5. `trpc.ts` `OWNER_ONLY_QUESTION_SOURCES` 加 `"PAPER_GENERATED"`（非 schema，列此备忘）。

均为加表/加列/加枚举，无破坏性迁移。

## 11. 测试

**单元**：`buildSpecTable`（聚合正确 / 空卷 / 单格合计）；`PaperGenerationOutputSchema` parse（畸形 JSON 拒）；mock `DEFAULT_PAPER` 确定性。

**集成（@zhijiao/web）**：
- `paper.generate` 全 AI（题库空）→ 落 Paper + N 个 PaperItem(AI_GENERATED) + N 个 Question(PAPER_GENERATED, owner=teacher)；扣 5 credits。
- 题库有命中 → 部分 BANK + 部分 AI，position 连续，分源正确。
- 生成失败（AI 抛错）→ 不落 Paper、补偿退 5。
- 跨教师访问他人 Paper → `NOT_FOUND`。
- 他人 `error.diagnose` 探测 PAPER_GENERATED questionId → `NOT_FOUND`（owner-only 回归）。
- 非教师 persona 调 `paper.generate` → 门禁拒。
- 注销教师 → Paper 级联删、PAPER_GENERATED 题 `createdByUserId` 置 null 保留。

**E2E**：教师登录 → 出卷参数 → 生成 → 预览见题/解析/细目表 → 打印页 200。

## 12. 后续 / punt

- 变量计费 + 费用预估 + 删换题退费。
- 换题 / 单题重生成 / 手动加题。
- 服务端 PDF / DOCX 导出。
- BANK 选题智能化（难度分布最优、跨 KP 配比）。
- 题库语料供给落地后回填 `cognitiveLevel` 标注、提升 BANK 命中。
