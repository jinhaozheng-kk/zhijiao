# Plan 18：AI 课件（结构化课件生成）—— 设计文档

- 日期：2026-06-04
- 状态：待实现
- 背景：项目 2026-06-04 完全转向教师生产力产品（AI 出卷 + AI 课件）。本 spec 是支柱 2。
- 关联：Plan 17（AI 出卷——复用其 `requireTeacherPersona` / AI 生成范式 / 教师 UI 脚手架 / PII 模式）、Plan 3（计费/补偿）、Plan 13（KP 树）。
- 复用既有登记：`LESSON_PLAN_GEN` 已在 `packages/billing/src/pricing.ts`（**3 credits**）与 `packages/domain/src/rbac.ts`（Permission，在 `DEFAULT_LOGGED_IN_PERMS`）登记；AI `tasks.ts` **无**对应 TaskKind（本 plan 补）。

## 0. 采纳的修正（相对初版设计）

1. **生成链：input 校验 + 教师门禁均在扣费前**。链 = `authedProcedure.input(GenerateCoursewareInput).use(requireTeacherPersona).use(requireGuardianConsent).use(chargeMiddleware("LESSON_PLAN_GEN"))`。参数非法 / 非教师 persona 都**不写 DEBIT**（范式见 `assignment.generateDraftFromCriteria`：`.input()` 在中间件前，中间件拿到已校验 `input`）。
2. **AI 输出强校验"五段齐全且唯一"**：`sections` 不是"数组 parse 过即成功"。schema 保证恰好 5 段、`INTRO/EXPLANATION/EXAMPLE/PITFALL/EXERCISE` 各 1 段；缺段/重复/额外段 → ZodError → `runJsonTaskWithAudit` retry 2 次再 `PARSE_FAILED`。落库 position 按固定顺序。
3. **状态流照 Plan 17 写清**：生成后 DRAFT；可编辑 section 的 content/title；`markReady → READY`；打印页 DRAFT/READY 都允许访问，READY 仅教师确认态、不做强门禁。
4. **数据模型补关系与索引**：`Courseware` 加 `teacher`/`subject` relation + `@@index([teacherUserId, status, createdAt])`；`User` 加 `teacherCoursewares Courseware[] @relation("TeacherCoursewares")`。

## 1. 目标与范围

教师按 **年级 / 知识点 / (可选)教学目标** 生成一份**结构化课件**（五段：课堂导入 / 讲解结构 / 例题 / 易错点 / 课堂练习），可在线预览、分段编辑、打印导出。

### in scope（v1）
- 独立 `Courseware` / `CoursewareSection`，教师自有，不绑班级。
- 复用 `LESSON_PLAN_GEN` 固定 3 credits。
- 五段固定结构；例题/课堂练习仅作段 `contentMd`，**不落 Question**。
- 生成 → 预览 → 分段编辑（content/title）→ markReady → 打印导出。

### out of scope（v1）
- 例题/练习落 Question / 进题库 / 复用。
- 增删段、换段、单段重生成。
- 服务端 Word/PDF 导出（打印页即导出）。
- 学生分发。

## 2. 数据模型

```prisma
enum CoursewareStatus { DRAFT READY }
enum CoursewareSectionType { INTRO EXPLANATION EXAMPLE PITFALL EXERCISE }  // 导入/讲解/例题/易错点/课堂练习

model Courseware {
  id                 String           @id @default(cuid())
  teacherUserId      String           @map("teacher_user_id")
  subjectId          String           @map("subject_id")
  title              String
  gradeLevel         GradeLevel?      @map("grade_level")
  status             CoursewareStatus @default(DRAFT)
  paramsJson         Json             @map("params_json")
  generationLedgerId String?          @map("generation_ledger_id")
  generationCallId   String?          @map("generation_call_id")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt @map("updated_at")

  teacher  User                @relation("TeacherCoursewares", fields: [teacherUserId], references: [id], onDelete: Restrict)
  subject  Subject             @relation(fields: [subjectId], references: [id])
  sections CoursewareSection[]

  @@index([teacherUserId, status, createdAt])
  @@map("coursewares")
}

model CoursewareSection {
  id           String                @id @default(cuid())
  coursewareId String                @map("courseware_id")
  position     Int
  type         CoursewareSectionType
  title        String
  contentMd    String                @db.Text @map("content_md")
  createdAt    DateTime              @default(now()) @map("created_at")

  courseware Courseware @relation(fields: [coursewareId], references: [id], onDelete: Cascade)

  @@unique([coursewareId, position])
  @@map("courseware_sections")
}
```

- `User` 加 `teacherCoursewares Courseware[] @relation("TeacherCoursewares")`。
- `Subject` 加 `coursewares Courseware[]`。
- 固定段顺序：INTRO(1) → EXPLANATION(2) → EXAMPLE(3) → PITFALL(4) → EXERCISE(5)。

## 3. AI（复用 LESSON_PLAN_GEN，3 credits）

- `tasks.ts`：加 TaskKind `LESSON_PLAN_GEN` + `TASK_MODEL_MAP.LESSON_PLAN_GEN = "qwen-max"`。
- prompt `packages/ai/src/prompts/lesson-plan-gen/v1.md`：输入 `{grade}/{kpNames}/{teachingGoal}`，输出 `{ title, sections:[{type,title,contentMd}] }`，**必须恰好五段、五类型各一**，按 导入/讲解/例题/易错点/课堂练习 排列。合规无提分/分数/通过/恐吓；按学段调整表达。只输出 JSON。
- `LessonPlanGenerationOutputSchema`（zod）+ **强校验**（§0.2）：
  ```ts
  export const CoursewareSectionTypeEnum = z.enum(["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"]);
  export const LessonPlanGenerationOutputSchema = z.object({
    title: z.string().min(1),
    sections: z.array(z.object({
      type: CoursewareSectionTypeEnum, title: z.string().min(1), contentMd: z.string().min(1),
    })).length(5),
  }).superRefine((v, ctx) => {
    const types = v.sections.map((s) => s.type);
    const need = ["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"];
    const set = new Set(types);
    if (set.size !== 5 || !need.every((t) => set.has(t as never))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sections 必须恰好五段且 INTRO/EXPLANATION/EXAMPLE/PITFALL/EXERCISE 各一" });
    }
  });
  ```
- `scanLessonPlanForForbidden`（复用统一禁词扫描，扫 title + 各段 title/contentMd）。
- `AiRouter.generateLessonPlan(input)`（仿 `generatePaper`：loadPrompt → ensurePromptInDb → interpolate → request(model=TASK_MODEL_MAP) → `runJsonTaskWithAudit`）。system message 含唯一关键词（如 "课件生成助手"）供 mock 派发。
- mock `DEFAULT_LESSON_PLAN`：五段齐全、合规、确定性。

落库时按 `need` 的固定顺序映射 position 1..5（不信任 AI 返回顺序，按 type 重排）。

## 4. 生成链与流程

`courseware.generate`：

```
authedProcedure
  .input(GenerateCoursewareInput)     // {gradeLevel, kpNames[].min(1), teachingGoal?, clientRequestId}
  .use(requireTeacherPersona)         // 复用 Plan 17：persona!=="TEACHER" → FORBIDDEN（扣费前）
  .use(requireGuardianConsent)
  .use(chargeMiddleware("LESSON_PLAN_GEN"))   // 固定 3 credits
  .mutation(resolver)
```

resolver：调 `generateLessonPlan` → 成功事务落 `Courseware(DRAFT)` + 5 个 `CoursewareSection`（按 type 固定顺序 position 1..5），`generationLedgerId=ctx.debit.ledgerId`、`generationCallId=modelCallId`。AI 失败（含五段校验失败 PARSE_FAILED）抛错 → 既有补偿退 3，不落 Courseware。

## 4.1 状态流（v1）

- 生成后 `status=DRAFT`。
- `courseware.updateSection({ coursewareId, sectionId, title?, contentMd? })` 改段标题/内容。
- `courseware.markReady` DRAFT→READY（确认态，不锁编辑）。
- 打印页 DRAFT/READY 都可访问，无强门禁。
- 所有 `courseware.*` 经 `requireTeacherPersona` + `validateCoursewareOwnership`（跨教师/不存在 → `NOT_FOUND`）。

## 5. 访问控制与 PII

- `courseware.*` 教师门禁 `requireTeacherPersona`（生成路径在扣费前）+ `validateCoursewareOwnership`（注入 ctx.courseware 含 sections）。
- **无 Question 牵连**（不落题），故无新增 owner-only Question 规则。
- PII（扩 Plan 6）：注销教师 → 删 `Courseware`（级联 `CoursewareSection`），payload 计 `coursewaresDeleted`；导出 `exportUserData` 加 `coursewares` 段（白名单：title/status/gradeLevel/createdAt/sections 的 type/title/contentMd），不含他人数据。

## 6. UI（仿 Plan 17）

- `/teacher/coursewares`：课件列表（标题/年级/状态徽标/时间 + 新建）。
- `/teacher/coursewares/new`：参数表单（年级 select / KP 多选 / 可选教学目标）→ 生成（`ui/ai-generating-panel` + 重试）。
- `/teacher/coursewares/[id]`：预览（五段顺序展示 + DRAFT/READY 徽标）+ 分段编辑（title/contentMd，调 `updateSection`）+ "确认完成"（markReady）+ 打印链接。`useSearchParams` 客户端组件 `<Suspense>` 包裹；JSX `"` 用 `&quot;`。
- `/teacher/coursewares/[id]/print`：打印友好页（五段排版，`@media print` 隐藏导航/按钮）。
- 教师导航 / 班级工作台把 `id="ai-courseware"` 的 Plan 18 占位卡换成真入口 `/teacher/coursewares`。

## 7. 合规

- 无提分 / 分数 / 通过 / 恐吓文案；课件定位教学辅助。
- 按学段调整表达（prompt 带 grade；小学=生活类比 / 初中=题型归类 / 高中=方法迁移）。
- 易错点段聚焦概念辨析，不制造焦虑。

## 8. Schema 变更汇总

1. 新枚举 `CoursewareStatus` / `CoursewareSectionType`。
2. 新表 `Courseware`、`CoursewareSection`。
3. `User` 加 relation `teacherCoursewares`；`Subject` 加 relation `coursewares`。
4. `tasks.ts` 加 TaskKind `LESSON_PLAN_GEN` + 模型映射（非 db schema，备忘）。
5. `trpc.ts` 加 `validateCoursewareOwnership`（非 schema，备忘）；`requireTeacherPersona` 复用 Plan 17（不重复加）。

均为加表/加枚举/加 relation，无破坏性迁移。

## 9. 测试

**单元**：`LessonPlanGenerationOutputSchema`——五段齐全过 / 缺段拒 / 重复段拒 / 6 段拒；mock `DEFAULT_LESSON_PLAN` 确定性。

**集成（@zhijiao/web）**：
- `courseware.generate` 教师 → 落 Courseware + 5 段（position 1..5 按固定 type 顺序）；扣 3 credits。
- 非教师 persona → **扣费前 FORBIDDEN，不写 DEBIT**。
- 参数非法（空 kpNames）→ 扣费前 BAD_REQUEST，不写 DEBIT。
- AI 返四段（mock 注入畸形）→ PARSE_FAILED → 补偿退 3、不落 Courseware。
- `updateSection` 改 content；跨教师 → NOT_FOUND。
- `markReady` DRAFT→READY；打印页 DRAFT/READY 都 200。
- 注销教师 → Courseware 级联删；导出含本人 coursewares。

**E2E**：教师登录 → 生成课件 → 预览见五段 → 编辑一段 → markReady → 打印页 200。

## 10. 后续 / punt

- 例题/练习落 Question + 进题库 + 复用。
- 增删段 / 换段 / 单段重生成。
- 服务端 PDF / DOCX 导出。
- 课件与出卷联动（同 KP 一键配套）。
- 多学科（当前单 math）。
