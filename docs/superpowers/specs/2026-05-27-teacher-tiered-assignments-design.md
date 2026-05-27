# 智教 · Plan 10 教师端分层作业 + AI 出题系统 Design Spec

**日期**：2026-05-27  
**状态**：Draft for user review  
**目标**：在 Plan 9 / Plan 12 已经把错题、变式题和知识点结构化打通之后，落地教师端完整作业闭环：班级薄弱点诊断、AI 分层出题、教师审核发布、学生分层作答、教师人工批改、错题本回流、作业报告。

## 1. Scope

Plan 10 一次设计完整作业系统 + AI 出题系统，并在 implementation plan 中按子系统分阶段落地。

包含：

- seeded/test classroom：真实 schema + seed 数据，但不做教师端建班 / 邀请 / 导入 UI。
- 教师班级诊断：按 KP、错因、学生薄弱点查看班级热度。
- AI 出题两入口：
  - 根据班级薄弱点一键生成分层作业。
  - 教师手动配置年级、学科、KP、难度、题型、题量后生成。
- 生成题按题量扣教师钱包：`1 credit / question`。
- AI 生成内容只进入草稿；教师可编辑/删除题目，整份作业确认后发布。
- 一份作业整班发布，每个学生按最终分层看到自己的题组。
- 学生支持客观题 + 文本题混合作答。
- 教师人工批改：`CORRECT / PARTIAL / WRONG`。
- `PARTIAL / WRONG` 写回学生错题本，并写轻量作业表现记录供 Plan 11 学情画像使用。

不包含：

- 真实班级 roster 管理 UI。
- AI 自动批改。
- 作业退回重做。
- AI 生成题公开入公共题库审核流。
- 消息通知 / 家长通知 / 微信模板消息。

## 2. Overall Architecture

主流程：

```text
教师看班级薄弱点
  -> AI 生成分层作业草稿
  -> 教师编辑整份草稿
  -> 发布给整班
  -> 学生按自己的 tier 作答
  -> 教师人工批改
  -> 错题本回流 + 作业报告
```

新增五个业务域：

1. **Classroom**：`Classroom`、`ClassroomMember`，Plan 10 只 seed，不做管理 UI。
2. **Assignment**：`Assignment`、`AssignmentTier`、`AssignmentItem`，承载草稿、发布、题组和题目快照。
3. **AI Generation**：`ASSIGNMENT_QUESTION_GEN` task/action，生成分层题目包。
4. **Submission**：`StudentAssignment`、`AssignmentAnswer`，保存学生分层映射和逐题答案。
5. **Grading / Report**：人工批改、错题本回流、`AssignmentPerformance` 记录。

状态流：

- `Assignment`: `DRAFT -> PUBLISHED -> CLOSED`
- `StudentAssignment`: `ASSIGNED -> SUBMITTED -> GRADED`
- `AssignmentItem`: DRAFT 可编辑；PUBLISHED 后题干、答案、解析、rubric 快照锁定。
- `AssignmentAnswer`: 学生提交后锁定原始答案；教师批改写 `gradeStatus` 和 feedback。

## 3. Prisma Data Model

### 3.1 Enums

```prisma
enum ClassroomMemberRole {
  TEACHER
  STUDENT
}

enum AssignmentStatus {
  DRAFT
  PUBLISHED
  CLOSED
}

enum AssignmentTierLevel {
  BASIC
  CONSOLIDATION
  CHALLENGE
}

enum StudentAssignmentStatus {
  ASSIGNED
  SUBMITTED
  GRADED
}

enum AssignmentGradeStatus {
  UNGRADED
  CORRECT
  PARTIAL
  WRONG
}
```

### 3.2 Classroom

```prisma
model Classroom {
  id          String      @id @default(cuid())
  name        String
  subjectId   String      @map("subject_id")
  gradeLevel  GradeLevel? @map("grade_level")
  createdAt   DateTime    @default(now()) @map("created_at")

  subject     Subject           @relation(fields: [subjectId], references: [id])
  members     ClassroomMember[]
  assignments Assignment[]

  @@map("classrooms")
}

model ClassroomMember {
  classroomId String              @map("classroom_id")
  userId      String              @map("user_id")
  role        ClassroomMemberRole
  createdAt   DateTime            @default(now()) @map("created_at")

  classroom   Classroom @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@id([classroomId, userId])
  @@index([userId, role])
  @@map("classroom_members")
}
```

Plan 10 seed 一个 math classroom，包含 `dev-teacher-01` 和若干 student fixtures。教师 UI 默认进入已有班级，不提供建班/导入学生入口。

### 3.3 Assignment

```prisma
model Assignment {
  id                 String           @id @default(cuid())
  classroomId        String           @map("classroom_id")
  teacherUserId      String           @map("teacher_user_id")
  title              String
  status             AssignmentStatus @default(DRAFT)
  source             String           // WEAKNESS_AI / MANUAL_AI / MIXED
  generationLedgerId String?          @map("generation_ledger_id")
  generationCallId   String?          @map("generation_call_id")
  publishedAt        DateTime?        @map("published_at")
  closedAt           DateTime?        @map("closed_at")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt @map("updated_at")

  classroom          Classroom            @relation(fields: [classroomId], references: [id], onDelete: Restrict)
  teacher            User                 @relation("TeacherAssignments", fields: [teacherUserId], references: [id], onDelete: Restrict)
  tiers              AssignmentTier[]
  studentAssignments StudentAssignment[]

  @@index([teacherUserId, status, createdAt])
  @@index([classroomId, status, createdAt])
  @@map("assignments")
}
```

`generationLedgerId` 指向扣费 DEBIT ledger；`generationCallId` 指向 AI audit `ModelCall.id`。不建立硬 FK，保持与现有 billing/audit 解耦风格一致。

### 3.4 Tier and Item

```prisma
model AssignmentTier {
  id           String              @id @default(cuid())
  assignmentId String              @map("assignment_id")
  level        AssignmentTierLevel
  title        String
  rationaleMd  String?             @db.Text @map("rationale_md")
  createdAt    DateTime            @default(now()) @map("created_at")

  assignment   Assignment       @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  items        AssignmentItem[]
  studentAssignments StudentAssignment[]

  @@unique([assignmentId, level])
  @@map("assignment_tiers")
}

model AssignmentItem {
  id           String       @id @default(cuid())
  tierId       String       @map("tier_id")
  questionId   String?      @map("question_id")
  position     Int
  stemMd       String       @db.Text @map("stem_md")
  type         QuestionType
  optionsJson  Json?        @map("options_json")
  answerMd     String       @db.Text @map("answer_md")
  solutionMd   String       @db.Text @map("solution_md")
  rubricMd     String?      @db.Text @map("rubric_md")
  kpHints      String[]     @default([]) @map("kp_hints")
  createdAt    DateTime     @default(now()) @map("created_at")

  tier         AssignmentTier @relation(fields: [tierId], references: [id], onDelete: Cascade)
  question     Question?      @relation(fields: [questionId], references: [id], onDelete: SetNull)
  answers      AssignmentAnswer[]

  @@unique([tierId, position])
  @@index([questionId])
  @@map("assignment_items")
}
```

`AssignmentItem` 保留作业题目快照。即使有 `questionId`，发布后的作业内容也以快照为准，避免后续题库编辑影响已发布作业和批改依据。

AI 生成题会创建 `Question(source="ASSIGNMENT_GENERATED", createdByUserId=teacherUserId, status="DRAFT")`，同时写 `AssignmentItem` 快照。Plan 10 不把这些私有题发布到公共题库。

### 3.5 Student Work

```prisma
model StudentAssignment {
  id                 String                  @id @default(cuid())
  assignmentId       String                  @map("assignment_id")
  studentUserId      String                  @map("student_user_id")
  tierId             String                  @map("tier_id")
  status             StudentAssignmentStatus @default(ASSIGNED)
  suggestedTier      AssignmentTierLevel?    @map("suggested_tier")
  tierOverrideReason String?                 @map("tier_override_reason")
  submittedAt        DateTime?               @map("submitted_at")
  gradedAt           DateTime?               @map("graded_at")
  createdAt          DateTime                @default(now()) @map("created_at")
  updatedAt          DateTime                @updatedAt @map("updated_at")

  assignment         Assignment        @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  tier               AssignmentTier    @relation(fields: [tierId], references: [id], onDelete: Restrict)
  student            User              @relation("StudentAssignments", fields: [studentUserId], references: [id], onDelete: Restrict)
  answers            AssignmentAnswer[]

  @@unique([assignmentId, studentUserId])
  @@index([studentUserId, status, createdAt])
  @@map("student_assignments")
}

model AssignmentAnswer {
  id                  String                @id @default(cuid())
  studentAssignmentId  String               @map("student_assignment_id")
  itemId              String                @map("item_id")
  answerJson          Json                  @map("answer_json")
  gradeStatus         AssignmentGradeStatus @default(UNGRADED) @map("grade_status")
  teacherFeedbackMd   String?               @db.Text @map("teacher_feedback_md")
  errorBookEntryId    String?               @map("error_book_entry_id")
  gradedAt            DateTime?             @map("graded_at")

  studentAssignment   StudentAssignment @relation(fields: [studentAssignmentId], references: [id], onDelete: Cascade)
  item                AssignmentItem    @relation(fields: [itemId], references: [id], onDelete: Restrict)
  errorBookEntry      ErrorBookEntry?   @relation(fields: [errorBookEntryId], references: [id], onDelete: SetNull)

  @@unique([studentAssignmentId, itemId])
  @@index([itemId, gradeStatus])
  @@map("assignment_answers")
}
```

`StudentAssignment.tierId` 是教师最终确认的 tier；`suggestedTier` 是系统建议，便于审计和后续分析。

### 3.6 Performance

```prisma
model AssignmentPerformance {
  id            String                @id @default(cuid())
  assignmentId  String                @map("assignment_id")
  studentUserId String                @map("student_user_id")
  itemId        String                @map("item_id")
  gradeStatus   AssignmentGradeStatus @map("grade_status")
  kpIds         String[]              @default([]) @map("kp_ids")
  createdAt     DateTime              @default(now()) @map("created_at")

  @@unique([assignmentId, studentUserId, itemId])
  @@index([studentUserId, createdAt])
  @@index([assignmentId])
  @@map("assignment_performance")
}
```

Plan 11 学情画像后续消费 `AssignmentPerformance + ErrorBookEntry + QuestionKPLink`。

Existing model back-relations to add:

```prisma
model User {
  classroomMemberships ClassroomMember[]
  teacherAssignments   Assignment[]        @relation("TeacherAssignments")
  studentAssignments   StudentAssignment[] @relation("StudentAssignments")
}

model Subject {
  classrooms Classroom[]
}

model Question {
  assignmentItems AssignmentItem[]
}

model ErrorBookEntry {
  assignmentAnswers AssignmentAnswer[]
}
```

These are schema-level relation fields only; they do not change existing business semantics.

### 3.7 PII Governance

Plan 6 的 PII service 需要补丁：

- 注销用户为 student：删除/脱敏其 `StudentAssignment`、`AssignmentAnswer.answerJson`、`AssignmentPerformance.studentUserId` 策略需明确。
- 注销用户为 teacher：assignment 教师归属字段需要 scrub 或保留为非 PII audit 摘要；班级和作业内容是否保留按“教学资料可保留、个人归属去标识化”处理。
- export 白名单新增 assignment/student-answer/performance 可导出摘要，禁止泄露其它学生答案。

## 4. AI Generation, Billing, Compliance

新增：

- AI `TaskKind`: `ASSIGNMENT_QUESTION_GEN`
- Billing `ActionKind`: `ASSIGNMENT_QUESTION_GEN`
- `PRICING.ASSIGNMENT_QUESTION_GEN = 1`
- Prompt: `packages/ai/src/prompts/assignment-question-gen/v1.md`
- Router method: `aiRouter.generateAssignmentQuestions(...)`

两种入口共用同一 AI router：

1. **Class weakness generation**
   - 输入：`classroomId`、目标 KP、rootCause 统计、学生分层建议、每层题量、题型偏好。
   - 服务端从 `ErrorBookEntry + QuestionKPLink + ClassroomMember` 聚合近 N 天数据。

2. **Manual criteria generation**
   - 输入：年级、学科、KP、难度、题型、每层题量、教学目标。
   - 不依赖班级热度，但仍校验教师属于该 classroom。

输出 schema：

```ts
{
  title: string;
  tiers: Array<{
    level: "BASIC" | "CONSOLIDATION" | "CHALLENGE";
    rationaleMd: string;
    items: Array<{
      type: QuestionType;
      stemMd: string;
      options?: Array<{ key: string; text: string }>;
      answerMd: string;
      solutionMd: string;
      rubricMd?: string;
      knowledgePointHints: string[];
      difficulty: 1 | 2 | 3 | 4 | 5;
    }>;
  }>;
}
```

Generation chain:

```text
validate teacher classroom access
  -> validate request/count cap
  -> variable charge ASSIGNMENT_QUESTION_GEN
  -> call AI
  -> parse / schema validate / compliance scan
  -> write Assignment DRAFT + tiers/items/questions
  -> reconcile KP hints
  -> return draft
```

Billing:

- Existing `chargeMiddleware(kind)` is fixed-price. Plan 10 needs `chargeVariableMiddleware(kind, units)` or equivalent special middleware.
- Cost = `priceOf(kind) * requestedQuestionCount`.
- `clientRequestId` required.
- Idempotency key:

```text
debit:ASSIGNMENT_QUESTION_GEN:<teacherUserId>:<clientRequestId>
```

Pre-debit failures:

- missing/cross-teacher classroom
- invalid tier counts
- total count > 30
- per-tier count > 10
- invalid KP/type/difficulty input

Compensated failures:

- adapter error
- parse/schema failure after retries
- service error after debit
- output compliance rejection

Output compliance rejection is compensated because the teacher paid for usable generated questions.

Publish does a second content compliance scan. Publish rejection is free and returns `BAD_REQUEST / ASSIGNMENT_CONTENT_REJECTED`.

## 5. tRPC API and Permissions

Add `assignmentRouter`.

### 5.1 Teacher APIs

```ts
assignment.teacherDashboard({ classroomId, days? })
```

Returns KP heat, root-cause distribution, weak students, recent assignment states. Free. Requires teacher membership.

```ts
assignment.generateDraftFromWeakness({
  classroomId,
  clientRequestId,
  days,
  tierCounts,
  questionTypes,
  targetKpIds?
})
```

Charged, weakness-based draft generation.

```ts
assignment.generateDraftFromCriteria({
  classroomId,
  clientRequestId,
  subjectId,
  gradeLevel,
  kpIds,
  difficultyRange,
  tierCounts,
  questionTypes,
  teachingGoalMd?
})
```

Charged, manual criteria draft generation.

```ts
assignment.updateDraft({ assignmentId, title?, itemUpdates?, itemDeletes?, tierUpdates? })
```

Free. Only assignment teacher. Only `DRAFT`. Updates `AssignmentItem` snapshots, not `Question`.

```ts
assignment.publish({ assignmentId })
```

Free. Only `DRAFT -> PUBLISHED`. Validates:

- content compliance
- every tier has at least one item
- classroom has at least one student
- tier assignments are valid

Creates/updates `StudentAssignment` rows with final tier mapping.

```ts
assignment.close({ assignmentId })
```

Free. `PUBLISHED -> CLOSED`.

```ts
assignment.gradeAnswer({ answerId, gradeStatus, rootCause?, teacherFeedbackMd? })
```

Free. Only assignment teacher. `PARTIAL / WRONG` require `rootCause`. Handles error-book writeback and performance upsert.

### 5.2 Student APIs

```ts
assignment.myList({ status? })
```

Current student only.

```ts
assignment.getForStudent({ studentAssignmentId })
```

Returns only this student's assigned tier items. Does not return other tiers or full-class tier mapping.

```ts
assignment.submit({ studentAssignmentId, answers: [{ itemId, answerJson }] })
```

Current student only. Rejects closed assignments, second submit, and item ids not in assigned tier.

### 5.3 Middleware

- `validateTeacherClassroomAccess`
- `validateTeacherAssignmentAccess`
- `validateStudentAssignmentAccess`
- `validateTeacherAnswerAccess`

Cross-class, cross-teacher, cross-student access returns merged `NOT_FOUND` errors:

- `CLASSROOM_NOT_FOUND`
- `ASSIGNMENT_NOT_FOUND`
- `STUDENT_ASSIGNMENT_NOT_FOUND`
- `ASSIGNMENT_ANSWER_NOT_FOUND`

Do not use `FORBIDDEN` for these owner-gated resources.

## 6. UI Workflow

### 6.1 Teacher

`/teacher`

- Real dashboard replacing stub.
- Shows seeded class card, recent assignments, pending grading count, KP weak points.
- Main actions: generate tiered assignment, view assignments.

`/teacher/classes/[classroomId]`

- Class diagnosis.
- Time range selector.
- KP heat table, root-cause distribution, weak student list.
- Entry point into weakness-based generation.

`/teacher/classes/[classroomId]/assignments/new`

- Two tabs:
  - by class weakness
  - by manual criteria
- Controls: KP multi-select, tier counts, question types, difficulty range, teaching goal.
- Shows estimated cost before submit.
- Successful generation navigates to draft editor.

`/teacher/assignments/[assignmentId]/edit`

- DRAFT-only editor.
- Three tier sections: BASIC / CONSOLIDATION / CHALLENGE.
- Per item edit: stem, options, answer, solution, rubric.
- Student tier suggestion list with teacher overrides.
- Publish button runs server validation.

`/teacher/assignments/[assignmentId]`

- Published/closed detail.
- Tabs:
  - overview: submission and grading progress
  - grading: by student or by question
  - report: KP/root-cause stats and error-book writeback count
- Close assignment action.

### 6.2 Student

`/assignments`

- My assignments: pending, submitted, graded.
- Shows "我的练习" and avoids displaying BASIC/CHALLENGE labels.

`/assignments/[studentAssignmentId]`

- Renders only assigned tier.
- Choice/fill/text/process answer controls.
- Submit confirmation; after submit, readonly.

`/assignments/[studentAssignmentId]/result`

- Shows grade status, teacher feedback, solution.
- Wrong/partial items link to error book when writeback exists.

UI copy constraints:

- No score/grade improvement guarantee.
- No fear-based copy.
- AI generation button must show credit cost and draft-review reminder.
- Publish compliance errors should be actionable without exposing the full forbidden phrase list.

## 7. State Machine and Feedback Loop

### 7.1 Assignment

- `DRAFT`: editable; invisible to students; can publish; can delete.
- `PUBLISHED`: immutable content; students can submit; teachers can grade; can close.
- `CLOSED`: no new submissions; teacher can grade existing answers; reports remain readable.

### 7.2 StudentAssignment

- `ASSIGNED`: student can submit.
- `SUBMITTED`: answer locked; teacher can grade.
- `GRADED`: student can view result; teacher can correct grading.

Plan 10 does not support return-for-redo.

### 7.3 Error Handling

- Draft edit after publish: `CONFLICT / ASSIGNMENT_STATE_CHANGED`
- Submit after close: `CONFLICT / ASSIGNMENT_CLOSED`
- Submit item outside assigned tier: `BAD_REQUEST / ASSIGNMENT_ITEM_NOT_ASSIGNED`
- Cross-owner grade: `NOT_FOUND / ASSIGNMENT_ANSWER_NOT_FOUND`
- Idempotent charged generation hit: `CONFLICT / ACTION_IDEMPOTENCY_HIT`
- Publish compliance reject: `BAD_REQUEST / ASSIGNMENT_CONTENT_REJECTED`
- Publish class with no students: `BAD_REQUEST / CLASSROOM_HAS_NO_STUDENTS`

### 7.4 Error Book Writeback

Only `WRONG` and `PARTIAL` write error book. `CORRECT` does not.

For `WRONG/PARTIAL`, teacher must select root cause:

- `CONCEPT_CONFUSION`
- `READING_ERROR`
- `FORMULA_MISUSE`
- `CALCULATION_SLIP`
- `TRANSFER_GAP`
- `OTHER`

Writeback rules:

- Each `AssignmentAnswer` binds at most one `ErrorBookEntry`.
- If `AssignmentItem.questionId` exists, use it.
- If missing, create a private generated question before writeback.
- `actualAnswerMd` is formatted from `answerJson`.
- `rootCauseReasoning` stores teacher feedback / assignment writeback note.
- `nextReviewAt = now + 1 day`.
- Existing ACTIVE entry for same student/question is updated.
- Existing ARCHIVED entry is revived to ACTIVE.
- Existing DELETED entry is not revived; create a new ACTIVE entry.
- If teacher later changes grade to `CORRECT`, do not hard-delete the linked error entry. Reports use current grade state for current counts.

### 7.5 AssignmentPerformance

Every grading write upserts:

- `assignmentId`
- `studentUserId`
- `itemId`
- `gradeStatus`
- `kpIds`

Grade correction overwrites the same row.

## 8. Testing Strategy

### 8.1 DB / Migration

- New tables and constraints exist.
- `resetDb()` truncation order includes assignment tables before users/questions.
- Seed includes one math classroom, one teacher, several students, memberships, and optional historical error/KP data.

### 8.2 AI / Billing

- `ASSIGNMENT_QUESTION_GEN` added to `TaskKind`, `ActionKind`, `PRICING`.
- AI router retries parse/schema failures.
- Compliance rejection audits and compensates.
- Variable charge deducts requested question count.
- Insufficient balance does not call AI.
- Cross-class/missing classroom does not debit.
- Idempotency prevents duplicate debit.

### 8.3 Router Permissions

- Teacher A cannot read/update/publish/grade teacher B assignment.
- Student A cannot read student B assignment.
- Student cannot see other tiers.
- Non-teacher classroom member cannot generate/publish.
- Published assignment rejects draft edits.
- Closed assignment rejects submit.
- Submit rejects item outside assigned tier.

### 8.4 State and Writeback

- Publish creates `StudentAssignment` rows.
- Empty tier and no-student publish fail.
- Student submit saves answer payload and rejects resubmit.
- Correct grading only writes performance.
- Wrong/partial grading requires root cause and writes error book.
- ARCHIVED error entry revives; DELETED creates new ACTIVE.
- Correcting grade back to correct preserves audit link but current report count updates.

### 8.5 E2E

Teacher:

- Login teacher fixture.
- Open `/teacher`.
- Diagnose class.
- Generate assignment with visible credit estimate.
- Edit draft.
- Publish.
- Grade submitted work.

Student:

- Login student fixture.
- Open `/assignments`.
- See assignment.
- Open only assigned tier.
- Submit.
- See result after teacher grades.
- Wrong/partial item appears in error book.

### 8.6 Merge Probes

Add to `CLAUDE.md`:

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-permissions.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/assignment-lifecycle.spec.ts
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
```

Red lines:

- No cross-class access returns `FORBIDDEN`.
- Charged generation validates teacher classroom access before debit.
- AI generation failure produces `DEBIT + COMPENSATION`, net balance unchanged.
- Published assignment item snapshots are immutable.

## 9. Implementation Notes

- Prefer a new `apps/web/server/routers/assignment.ts`.
- Reuse existing `chargeMiddleware` style, but introduce variable charge support with tests before using it in assignment generation.
- Reuse `validateQuestionAccess` owner-only pattern for `ASSIGNMENT_GENERATED` questions if those questions become diagnosable later.
- Add `ASSIGNMENT_GENERATED` to question source handling wherever owner-only private questions are checked.
- Do not make generated assignment questions public `PUBLISHED` content.
- Keep dashboard aggregation in server-side helper functions so tests can exercise them without rendering UI.
- Patch Plan 6 PII services in the same plan; assignment data contains student answers and teacher-created content.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Scope is large | Implementation plan must phase by subsystem and keep roster management / AI grading out of scope. |
| Variable billing breaks existing fixed-charge callers | Add new middleware without changing current `chargedProcedure(kind)` behavior. |
| Cross-class data leak | Owner-gated middleware and negative tests for every procedure. |
| AI output unusable but charged | Compliance/parse/adapter failures compensate. |
| Published assignment drift | Store immutable `AssignmentItem` snapshots and block edits after publish. |
| Error-book duplicate pollution | Reuse Plan 4 active/archived partial unique semantics and respect DELETED terminal state. |
