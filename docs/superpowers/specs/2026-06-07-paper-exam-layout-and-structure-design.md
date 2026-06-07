# 出卷·结构化 + 国内统考排版 —— 设计文档

- 日期：2026-06-07
- 状态：待实现
- 背景：项目已转向教师生产力（AI 出卷 + AI 课件）。Plan 17 AI 出卷已落地、功能闭环，但生成参数与打印版式停留在"扁平题表"，不符合国内统一考试（首批用户=初中数学，按中考数学惯例）的卷面要求。本子项目把出卷做到"开箱即用的统考卷"。
- 关联：Plan 17（`Paper` / `PaperItem` / `PAPER_GEN` 计费 / owner-only / 双向细目表 `buildSpecTable`）、Plan 13（KP 树）、Plan 3（计费补偿）、Plan 6/12（owner-only + PII）。
- 范围标识：出卷完善 4 子项目中的**子项目 1（承重）**。子项目 2（预览编辑增强）、3（Word 导出）、4（课件幻灯片）另写 spec，且 2/3 依赖本子项目的结构化产物。

## 0. 关键决策（已与用户确认）

1. **作答方式 = 题答合一卷（题卷含作答区）**：选择题答案统一填涂表放卷头；填空题题下留横线；解答题题下留空作答。不做独立答题卡（那是更高一档，留后续）。
2. **学生卷 / 教师卷分离**：教师卷 = 学生卷同结构 + **逐题穿插**「答案 / 解析 /（主观题）评分标准」。
3. **教材版本 = 轻量**：下拉选项（人教 / 北师大 / 华师大 / 苏科 / 浙教 / 通用，默认通用），存进 `paramsJson` + 渲染为卷头标签 + 作为 AI prompt 提示。**不进数据模型、不作题库筛选维度**（当前 KP 树是全学段单 math subject，无教材版本数据）。
4. **参数粒度 = 每题型分设题数 + 每题分值**：满分自动汇总；分值**以教师设定为准**（确定性满分），不采信 AI 返回的 `points`。
5. **大题分组 = 渲染时计算**：不新增持久化 section 模型，沿用双向细目表"渲染时算"的范式。
6. **不新增 DB 列、不新增 migration**：考试时长 / 教材版本只进 `Paper.paramsJson`；满分 = 题分之和（已由 `buildSpecTable` 算出）。

## 1. 目标与范围

教师按 **年级 / 知识点 / 难度 /（每题型）题数与分值 / 考试时长 / 教材版本** 生成一份**符合国内统考卷面**的练习卷：带卷头块、密封装订线、客观题作答区、按题型分大题（中文序号 + 大题小计）、解答题留空；可一键切换**学生卷 / 教师卷（含答案解析）**，用打印友好页导出（浏览器打印/另存 PDF）。

### in scope（本子项目）
- 表单：每题型「题数 × 每题分值」+ 考试时长 + 教材版本 + 满分实时汇总。
- 契约：`paper.generate` 入参由 `questionTypes`+`count` 改为 `sections[{type,count,pointsPerItem}]` + `durationMinutes` + `textbookVersion`。
- 题库择优按题型分别命中；不足才让 AI 补该题型缺口。AI prompt 带教材版本提示。
- 落库：按每题型 `pointsPerItem` 赋分；考试时长 / 教材版本进 `paramsJson`。
- 纯函数 `paper-exam-layout`：扁平 `PaperItem[]` → 有序大题 + 中文序号 + 大题小计 + 全卷连续小题号。
- 打印页重做：学生卷 / 教师卷双视图，统考版式（卷头 / 密封线 / 客观题作答区 / 大题分组 / 解答题留空）。
- mock adapter 按"每题型题数"产出对应结构。
- 测试：分组纯函数单测、表单校验单测、`paper.generate` 集成、E2E（生成→预览→打印→切卷）、向后兼容旧 Paper。

### out of scope（本子项目）
- 独立机读答题卡（选择题填涂卡 + 主观题作答框分离输出）。
- 服务端 Word/docx 文件导出（子项目 3）。
- 预览页的单题重生 / 加题 / 改题面 / 拖拽排序（子项目 2）。
- 课件相关一切（子项目 4）。
- 题库语料供给本身（独立工作；本子项目仅在题库存在时按题型择优混入）。
- 多学科 / 多省卷面差异（v1 只做中考数学通用版式；A4 单栏）。

## 2. 数据模型

**无 schema 变更、无 migration。** 复用 Plan 17 的 `Paper` / `PaperItem`。新增信息全部落 `Paper.paramsJson`：

```jsonc
// Paper.paramsJson（由 paper.generate 入参原样写入，新增字段）
{
  "subjectId": "...",
  "kpIds": ["..."],
  "gradeLevel": "G8",
  "difficultyRange": [2, 4],
  "sections": [                       // 替换原 questionTypes + count
    { "type": "SINGLE_CHOICE", "count": 6, "pointsPerItem": 3 },
    { "type": "FILL_BLANK",    "count": 4, "pointsPerItem": 3 },
    { "type": "CALCULATION",   "count": 5, "pointsPerItem": 8 }
  ],
  "durationMinutes": 120,             // 新增
  "textbookVersion": "RENJIAO",       // 新增；枚举见 §6
  "clientRequestId": "..."
}
```

`PaperItem.points` 在落库时取所属 section 的 `pointsPerItem`（而非旧的固定 5）。满分 = Σ points，由 `buildSpecTable(...).totalPoints` 给出，**不另存**。

## 3. 契约变更

### 3.1 `paper.generate` 入参（`apps/web/server/routers/paper.ts`）

```ts
const Section = z.object({
  type: QType,
  count: z.number().int().min(1).max(30),
  pointsPerItem: z.number().int().min(1).max(100),
});
const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]),
  sections: z.array(Section).min(1)
    .refine(s => new Set(s.map(x => x.type)).size === s.length, "题型不可重复")
    .refine(s => s.reduce((n, x) => n + x.count, 0) <= 30, "总题量不超过 30")
    .refine(s => s.reduce((n, x) => n + x.count, 0) >= 1, "至少 1 题"),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  textbookVersion: TextbookVersionEnum.default("GENERIC"),
  clientRequestId: z.string().uuid(),
});
```

中间件链不变：`.input → requireTeacherPersona → requireGuardianConsent → chargeMiddleware("PAPER_GEN") → resolver`。计费仍固定 5 credits；KP↔subject 校验仍在扣费后、失败补偿净零、不落 Paper（红线不变）。

### 3.2 生成逻辑（resolver + `lib/paper-generation.ts`）

- **按题型分别命中题库**：`selectBankQuestions` 改为接受单题型 + limit，resolver 对每个 section 调一次（或 `selectBankQuestions` 内按 section 循环），各题型独立 best-effort。
- **AI 补每题型缺口**：对 `gap_type = section.count - bankHit_type > 0` 的题型调 `generatePaper`，传该题型 + gap 数；AI 输入新增 `sections`（题型→数量）+ `textbookVersion` 提示。
- **分值确定性**：落库时 `PaperItem.points = section.pointsPerItem`（BANK 与 AI 题一致），**忽略 AI 返回的 points**。
- `persistGeneratedPaper` 入参增加每题的 points 来源（按 section 映射），其余不变（仍落 `Question(PAPER_GENERATED)` + reconcile KP）。

### 3.3 AI 契约（`packages/ai/src/schemas.ts` + `router.ts` + mock）

- `PaperGenerationInputSchema`：`questionTypes`+`count` → `sections: [{type,count}]`（生成侧不需 pointsPerItem）；新增 `textbookVersion?: string` 提示。
- `PaperGenerationOutputSchema`：不变（仍 `title` + `items[]`）。`items[].points` 保留但调用方不采信。
- prompt v 版本号会因模板变更上升（注意：手动验证前须 TRUNCATE `prompt_templates` 避免 fingerprint 冲突——既有护栏，非 bug）。
- **mock adapter**：`DEFAULT_PAPER` mock 改为按请求 `sections`（题型×数量）产出对应题，保证 E2E/demo 得到正确版式与题量。

## 4. 结构化分组（纯函数）

新增 `apps/web/lib/paper-exam-layout.ts`（纯函数，客户端打印页与单测共用，镜像 `paper-spec-table.ts` 模式）：

```ts
const SECTION_ORDER = ["SINGLE_CHOICE","MULTI_CHOICE","FILL_BLANK","CALCULATION","PROOF","ESSAY"] as const;
const CN_NUM = ["一","二","三","四","五","六","七","八","九","十"];

interface ExamLayoutItem { item: PaperItem; questionNo: number; } // 全卷连续小题号
interface ExamSection {
  type: QuestionTypeValue;
  cnIndex: string;            // 大题中文序号「一」
  title: string;              // 「选择题」
  caption: string;            // 「（本大题共 6 小题，每小题 3 分，共 18 分）」；分值不一时改「每小题分值见题」
  items: ExamLayoutItem[];
  subtotalPoints: number;
}
function buildExamLayout(items: PaperItem[]): { sections: ExamSection[]; totalPoints: number };
```

规则：
- 按 `SECTION_ORDER` 给出现的题型分大题；同题型内按 `position` 排序。
- `cnIndex` = 出现的大题序（一、二、三…）。
- `questionNo` 全卷连续 1..N（跨大题不重置——符合统考小题连续编号惯例）。
- `caption`：同大题内每题分值一致时「每小题 X 分」；不一致时「分值见题」并各题标注。
- 客观题（SINGLE_CHOICE/MULTI_CHOICE）由打印层据 type 判定，渲染卷头作答表。

## 5. 统考排版渲染（学生卷 / 教师卷）

`apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx` 重做。工具栏（`print-hidden`）加**「学生卷 / 教师卷」切换**（本地 state），两套从 `paper.get` 同一数据 + `buildExamLayout` 渲染。

### 5.1 学生卷
- **卷头块**：标题居中（学校 ___ + 年级 + 学科 +（教材版本标签））；副行「考试时长 {durationMinutes} 分钟 · 满分 {totalPoints} 分」（缺省时省略时长）；考生信息栏「姓名____ 班级____ 考号____ 座位号____」留空横线；标准注意事项（静态模板，见 §6）。
- **左侧密封/装订线**：纯打印 CSS（竖排「姓名__ 班级__ 考号__ ……装……订……线……内……不……要……答……题……」），`@media print` 才出现。
- **客观题作答区**：所有客观题（选择/多选）题号→填涂格表，置于卷头下方。
- **大题分组**：「{cnIndex}、{title}{caption}」标题；其下题目按 `questionNo` 编号；选项随题；填空题题面后接答题横线；解答题题下留固定 `min-height` 空白作答区。
- 分页：大题不强制分页；解答题区用 `break-inside: avoid` 尽量不跨页断题。

### 5.2 教师卷
- 同 §5.1 结构（卷头可加「教师卷·含答案」水印/标识），**逐题穿插**：每题答题区位置替换为「答案：… / 解析：… /（主观题）评分标准：…」。
- **双向细目表**附在教师卷末页（`buildSpecTable`，已有），学生卷不含。

### 5.3 兼容
- 旧 Paper 的 `paramsJson` 无 `durationMinutes`/`textbookVersion`/`sections` 时：卷头省略时长/教材版本标签；分组只按 `item.type`，旧卷照样渲染为新版式。`paper.get` 需确保返回 `paramsJson`（`validatePaperOwnership` 注入的 `ctx.paper` 已含；若 select 收窄需放开）。

## 6. 文案与枚举（`apps/web/lib/paper-copy.ts`）

- `TextbookVersionEnum` + label：`RENJIAO 人教版` / `BSD 北师大版` / `HUASHI 华师大版` / `SUKE 苏科版` / `ZHEJIAO 浙教版` / `GENERIC 通用`。
- 大题标题映射：题型 → 「选择题/多选题/填空题/计算题/证明题/解答题」。
- 注意事项静态模板（合规：**不得**含提分/分数/通过措辞）：示例「1. 答题前请将姓名、班级、考号填写清楚。2. 选择题答案填涂在卷头答题表内，其余各题在对应题目下方作答。3. 保持卷面整洁。」
- 卷头标签拼接 helper。

## 7. 合规

- 卷头 / 注意事项 / 大题标题均为静态模板，无提分/分数/通过/押题措辞。
- AI 题面输出仍过 `scanPaperGenerationForForbidden`（`findForbidden`），无变化。

## 8. 测试

- **单测** `paper-exam-layout`：题型排序、中文序号、小题号全卷连续、大题小计、同/异分值 caption 分支、空与单题型边界。
- **单测** 表单：满分实时汇总、总题量 ≤30 校验、题型不重复、`pointsPerItem`/`count` 边界。
- **单测** `paper-copy`：教材版本 label、大题标题映射。
- **集成** `paper.generate`：`sections` 入参 → `PaperItem.points` 按题型正确、`paramsJson` 含 duration/textbook、KP↔subject mismatch 仍补偿净零不落 Paper、非教师扣费前 FORBIDDEN。
- **集成** mock：按 `sections` 出题数量/题型正确。
- **E2E** `teacher-paper.spec.ts`（更新）：填每题型题数分值 → 生成 → 预览 → 打印页 → 切换学生卷/教师卷断言（卷头、大题标题、客观题作答表、教师卷答案穿插、细目表仅教师卷）。
- **更新**：`paper-generate.test.ts`、`paper-generation-lib.test.ts`、`paper-ui.test.tsx`、`paper-spec-table.test.ts`（若受 points 来源影响）随契约调整断言。
- **回归**：Plan 17 既有探针（owner-only `PAPER_GENERATED`、PII 注销/导出含 papers）不回退。

## 9. 风险与代价

- **契约破坏性变更**：`paper.generate` 入参结构改变。唯一调用方是出卷表单，同 PR 一并改；旧 `paramsJson` 仅影响渲染（已做兼容回退）。
- **mock 结构化**：mock 须按 sections 出题，否则 E2E 版式断言失真——纳入本子项目。
- **prompt 版本上升**：模板改动会令 fingerprint 变化，手动验证前须 TRUNCATE `prompt_templates`（既有护栏）。
- **题库按题型命中**可能更稀疏（按题型分别 take），但策略仍 best-effort + AI 补缺，不阻塞。
- **打印版式**为浏览器打印近似统考卷，非像素级还原；像素级/Word 还原属子项目 3。

## 10. 落地后文档

实现合并后：在 `docs/claude/implementation-state.md` 的「AI 出卷现状（Plan 17）」段追加"统考排版/结构化"小节（参数粒度、paramsJson 新字段、`buildExamLayout`、学生卷/教师卷渲染、无 migration）；在 `docs/claude/merge-verification.md` 追加本子项目回归探针。CLAUDE.md 不写回。
