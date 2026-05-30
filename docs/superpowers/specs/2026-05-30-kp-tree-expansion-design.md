# Plan 13: KP 树扩充（初中数学优先，全学段）— Design

> 状态：草案，待用户审阅。
> 关联：喂饱 Plan 9（KP reconciler）/ Plan 11（学情画像掌握度）。
> 决策授权：用户委托 Claude 做技术取舍并产出方案；Claude 负责校验数据、找错堵漏，用户只读审计。

## 1. 目标与非目标

**目标**

- 把当前仅 4 个 math KP 的占位树，扩成覆盖**小学 / 初中 / 高中**全学段的知识点树。
- **初中数学做全做透**（首发垂直方向）；小学 / 高中作为同 plan 内的独立数据文件先行 seed，作为样本与未来扩展骨架。
- 课标对齐：用户按课标手写数据文件，Claude 提供**自动校验**（碰撞 / 孤儿 / 歧义）兜底，不靠人记。
- 喂饱 reconciler：初中常见知识点名 / 别名能被 `reconcileHintsSync` EXACT/ALIAS 命中。

**非目标（YAGNI）**

- 不做 schema migration（`KnowledgePoint.parentId` 树已够用）。
- 不拆 `Subject`（见 §7 决策记录）。
- 不回填存量数据（只 seed 树 + alias，存量靠未来按需重跑 reconciler）。
- 不引入年级（grade）结构化字段；需要时放 `description` 文字标注。
- 不做 Web 端 KP 管理 / 审核页（单运营，CLI 已覆盖）。

## 2. 架构与数据结构

**无 migration。** 纯 seed/数据 + alias + 校验 + 测试。

4 层全部是 `KnowledgePoint` 行，靠 `parentId` 连成树（单一 `math` subject 内）：

```
学段(L1, parentId=null) → 领域(L2) → 主题(L3) → KP 叶子(L4)
初中                     → 数与代数  → 方程与不等式 → 一次方程求解
```

- **L1 学段**：小学 / 初中 / 高中（3 个根，`parentId=null`）。
- **L2 领域**：**按学段分别定义，不全树共用一套**（Finding A）。
  - 小学 / 初中（义教课标 2022）：数与代数 / 图形与几何 / 统计与概率 / 综合与实践。
  - 高中（普高课标 2017/2020）：函数 / 几何与代数 / 概率与统计 / 数学建模与探究 等主线——以用户手写数据文件为准，spec 不把"四领域"写成全学段通用。
- **L3 主题**：方程与不等式、函数、三角形…
- **L4 KP 叶子**：实际用于 reconciler 匹配 + Plan 11 掌握度聚合的最细粒度。

**字段语义**

- `difficulty`（1–5）仅**叶子**有意义（课标估值）；容器节点（学段/领域/主题）一律默认 `3`，下游不读容器 difficulty（见 §5 leaf-only 守卫保证容器不进聚合）。
- `code` 全 math subject 内唯一（`@@unique([subjectId, code])`）。编码方案 `math-<学段>-<领域>-<主题>-<kp>`，学段段用 `pri` / `jh` / `sh`，**天然保证跨学段同名也不撞 code**（"函数"在初中、高中各有独立 code）。

## 3. 数据文件结构与加载器

**分学段数据文件**（便于分学段审计、分学段做深浅）：

```
packages/db/prisma/seed/kp-data/
  types.ts          # KpNode 类型 + validateKpData 校验器
  junior-math.ts    # 初中（做全做透）
  primary-math.ts   # 小学（样本骨架）
  senior-math.ts    # 高中（样本骨架）
```

**节点类型**（递归）：

```ts
export type KpNode = {
  code: string;            // 学科内唯一，如 "math-jh-alg-eq-linear-solve"
  name: string;
  difficulty?: number;     // 仅叶子；默认 3
  aliases?: string[];      // 仅叶子可有；容器带 alias 视为数据错误
  children?: KpNode[];
};
```

**加载器**（`0_curriculum.ts` 重写为通用 loader）：

- `seedSubjectKpTree(prisma, subjectId, roots: KpNode[])`：深度优先 upsert，父 id 透传给子 `parentId`。每个节点 `upsert({ where: subjectId_code, create, update: { name, difficulty, parentId } })`——**幂等**，重跑只刷 name/difficulty/parentId，不重复建行。
- 容器节点 `difficulty` 不写（取 schema default 3）；叶子写 `difficulty ?? 3`。

**与现有 4 个 KP 的衔接**

- 现有 `math-g8-linear-eq` / `-solve` / `-apply` / `-system` 的 **code 保持不变**（避免动 `3_kp_aliases.ts` 的 code 引用与任何按 code 的探针）；它们被**重新挂到**新树 `初中 → 数与代数 → 方程与不等式` 下（loader 写新的 `parentId`）。
- `QuestionKPLink` 按 `kpId` 引用，re-parent 不影响既有链接。
- 已知小代价：这 4 个 code 用旧 `math-g8-` 前缀，与新 `math-jh-` 方案不一致——**接受，不重命名**（重命名收益为零、风险非零）。新节点一律用新方案。

## 4. Alias 策略 + 防碰撞校验（拆掉潜伏雷）

**潜伏雷**（agent 调查确认）：`KpAlias` 是 `@@unique([subjectId, normalizedAlias])`，而 seed upsert 的 `update: {}` 是空操作。若手写数据里给跨学段同名 alias（初中 / 高中都写一个 `"函数"`），第二条 upsert **静默指向先建的那个 KP**，不报错——一颗安静的错绑雷。

**对策——把"别犯错"变成"犯错即报"：**

`validateKpData(allTrees: KpNode[])` 在 **seed 入口**和**单元测试**两处运行，命中即 `throw`：

1. **code 全局唯一**：跨所有学段 data 文件，`code` 不得重复。
2. **alias 全局唯一**（核心）：跨所有学段，`normalizeKpHint(alias)` 不得重复——直接挡住"函数"被两个学段抢绑。命中时报出冲突的两个 code，让用户在数据里消歧（如改成 `二次函数` / `一次函数` 或加学段限定词）。
3. **alias 只挂叶子**：带 `children` 的容器节点若有 `aliases` 字段 → 报错（容器不该是 reconcile 目标）。
4. **alias ≠ 多义 name**（warn 级）：若某 alias 文本恰等于一个被 ≥2 个 KP 共用的 `name`，告警提示其本就歧义、不会 EXACT 命中。

`3_kp_aliases.ts` 重构为**消费同一批 data 文件的叶子 `aliases`**（单一真源，不再手维护独立 alias 列表）；seeding 顺序不变（先树后 alias）。现有初中 3 条 alias 迁入 `junior-math.ts` 对应叶子。

## 5. Reconciler leaf-only 守卫（Finding C）

**问题**：`reconcileHintsSync` 当前对匹配到的节点无差别写 `QuestionKPLink`（`kp-reconcile.ts:198`），容器名只要唯一就会被 EXACT 命中。本 plan 首次引入大量容器（领域/主题），"数与代数""三角形"这类容器名撞 hint 的概率显著上升 → Plan 11 掌握度（按 `kpId` 聚合）会被粗粒度容器污染。

**修法**（小而有界，仅动 `loadSubjectCandidates`）：

- 加载时计算叶子集合：`leaf = kp.id ∉ { 任意 kp.parentId }`。
- **只把叶子加入 `kpByNormalized`（name + code 两个池）**；容器永不进 EXACT 池。
- `aliasByNormalized` 不变——§4 校验已保证 alias 只挂叶子，故 alias 命中天然指向叶子。

**安全性核对**：现有 `一次方程`（容器，3 子）此前靠 alias 映到 `-solve` 叶子，name 本身不该匹配容器——leaf-only 后 name `一次方程` 不再命中容器，alias `一次方程`→solve 叶子照常工作，行为更正确，无回归。

## 6. 已知代价（Finding B 决策记录）

**决策：单 `math` subject，全学段一棵树，不拆 subject。**

- 拆 3 个 subject（`math-primary/junior/senior`）改动量**中等且分布广**（`question.ts:60` adhoc 选 subject、`assignment.ts:109` AI 学科串、~26 个 test 硬编码 `"math"`），且引入真实业务难题（学生改 grade 后历史题归属、analytics 是否跨学段汇总同一 KP）。
- 单 subject 的代价——跨学段同名节点（"函数""不等式"）无法 EXACT/ALIAS 自动匹配——在**首发初中-only**场景下接近于零：初中现有 KP 无同名；小学/高中先 seed 但暂无题，reconciler 根本不被调用。
- **关键语义**：跨学段同名匹配不上**不是 bug，是正确的保守行为**——reconciler name-count 守卫（`kp-reconcile.ts:82-87`）遇歧义名不猜，落 `UNMATCHED` 等 LLM/人工裁决。三处调用点均 try/catch + `logger.warn`，主流程不受影响。
- 未来若高中真正上量、同名匹配成为瓶颈，再开独立 plan 评估拆 subject——届时数据已分学段文件，迁移成本可控。

## 7. 测试与验收

**单元**（`packages/db` 或 `apps/web`）

- `validateKpData`：构造重复 code / 重复 alias / 容器带 alias 三种坏数据，断言各自 throw；好数据通过。
- leaf-only 守卫：构造"容器名唯一"场景，断言 hint 命中容器名时**不**写 QuestionKPLink（落 UNMATCHED）；叶子名照常 LINKED。

**集成 / 探针**

- seed 幂等：连跑两次 `db:seed`，KP 行数稳定、无重复，现有 4 KP 被 re-parent 到新树且 `QuestionKPLink` 不变。
- 现有 reconciler 测试（`kp-reconcile-*`）全绿，证明 leaf-only 改动无回归。
- 数据规模探针：初中叶子数达到课标主干覆盖（具体阈值随用户手写数据定）。

**CLAUDE.md 新增红线（落地后补）**

- KP data 校验在 seed 入口运行：坏数据 seed 直接 throw，不静默。
- reconciler 只链叶子：`Select-String` 守 `loadSubjectCandidates` 含 leaf 过滤。

## 8. 文件清单（落地预览）

| 文件 | 动作 |
|---|---|
| `packages/db/prisma/seed/kp-data/types.ts` | 新增：`KpNode` + `validateKpData` |
| `packages/db/prisma/seed/kp-data/{junior,primary,senior}-math.ts` | 新增：分学段手写树（含叶子 inline aliases） |
| `packages/db/prisma/seed/0_curriculum.ts` | 重写：通用 `seedSubjectKpTree` loader + 调 validate |
| `packages/db/prisma/seed/3_kp_aliases.ts` | 重构：消费 data 文件叶子 aliases，单一真源 |
| `apps/web/server/lib/kp-reconcile.ts` | 改 `loadSubjectCandidates`：leaf-only EXACT 池 |
| 测试文件 | 新增 validate / leaf-only 用例 |

## 9. Punt（留给后续）

- 高中真正上量后再评估拆 subject。
- KP 树持续扩充（小学/高中做深）作为后续数据迭代，不必新 plan。
- 旧 `math-g8-` 前缀统一为 `math-jh-`（收益低，长期可选）。
