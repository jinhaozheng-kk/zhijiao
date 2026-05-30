# Plan 14c: 通用 PII 扫描器（落库前脱敏）— Design

> 状态：草案，待用户审阅。
> 来源：Plan 14（未成年人保护 / PIPL 完版）拆分出的第三子项（14a 已落地；14b DSAR 独立）。
> 收口 Plan 8 §punt（"PII 扫描（手机号 / 身份证 regex）未做通用扫描器"）。
> 法务依据：PIPL 数据最小化——不必要的 PII 不持久化、不向第三方（LLM 提供商）传输。

## 1. 目标与非目标

**目标**

- 提供可复用的纯函数 PII 检测/脱敏核（手机号、身份证）。
- 在自由文本**落库前 + 发 LLM 前**脱敏用户输入（最小化存储与传输）。
- 在 AI 输出**持久化 + 解析前**脱敏（防御纵深）。
- 全程不把命中的 PII 原值带进日志。

**非目标（YAGNI）**

- 只覆盖**手机号 + 身份证**（Plan 8 punt 明确）；不做 email / 银行卡 / 地址 / 姓名。
- **不回扫存量**（只管新写入；历史 `USER_ADHOC Question.stemMd` 不回扫——可后续独立 backfill）。
- 不阻断输入（落库前脱敏，不拒绝；与违禁词 `validateTutorInputCompliance` 的"命中即拒"不同）。
- 不做部分掩码（全占位）。
- 不接入运营可配置词库（PII 模式是固定算法，非黑词表）。

## 2. 检测/脱敏核（`packages/domain/src/pii.ts`）

纯函数，零依赖，镜像现有 `compliance.ts` 的风格。`@zhijiao/domain` 是无 workspace 依赖的叶子包，`@zhijiao/ai` 已依赖它（无循环）。

**模式**

- **手机号**：`/(?<!\d)1[3-9]\d{9}(?!\d)/g` —— 数字边界（lookbehind/lookahead）避免命中更长数字串的中段。占位 `[手机号]`。
- **身份证（18 位）**：结构化正则 + MOD-11 校验位双重判定，命中且校验通过才脱敏：
  - 正则：`/(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g`（6 位地区 + 19/20 世纪年 + 合法月日 + 3 位序 + 校验位 `0-9` 或 `X`）。
  - **校验**：对正则命中的候选跑 GB11643 MOD-11-2 校验位算法；**校验失败的 18 位数不脱敏**（避免误伤无关长数字，如订单号）。
  - 占位 `[身份证号]`。15 位旧身份证不覆盖（已停发，YAGNI；如需后续加）。

**API**

```ts
export type PiiType = "PHONE" | "ID_CARD";
// 只返回类型与计数，绝不返回命中的原始值（防 PII 流进日志/审计）。
export function scanPii(text: string): { phone: number; idCard: number };
export function redactPii(text: string): { redacted: string; hits: { phone: number; idCard: number } };
```

- `redactPii` 顺序：先脱敏身份证（更长、更具体）再手机号，避免身份证片段被手机号正则误吃（身份证中段含 11 位数可能匹配手机模式）。落实为：先替换 ID_CARD，再在结果上替换 PHONE。
- 输入非 string / 空 → 原样返回 `{ redacted: text, hits: {phone:0, idCard:0} }`。

## 3. 输入侧脱敏（发 LLM 前 + 落库前）

误伤率低（11 位 13-19 开头 / 校验通过的 18 位号在合法数学题中极罕见），故在最早边界一次脱敏，同时最小化对第三方 LLM 的传输与本地存储。

**`tutor.ask`（`apps/web/server/routers/tutor.ts` body）**

- 现链：`authedProcedure → validateTutorInputCompliance（违禁词，扣费前）→ chargeMiddleware → body`。
- 在 body 内、AI 调用**之前**：`const { redacted } = redactPii(input.questionStem)`。
- 用 `redacted` 喂 AI（`aiInput.questionStem = redacted`）**且** upsert（`upsertUserAdhocQuestion({ stemMd: redacted })`）。
- redact 放 body（不放中间件）：tRPC 中间件无法改写传给 body 的 `input`。
- 若脱敏发生，`logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK", hits })`（只记类型计数）。

**`error.diagnose`（`apps/web/server/routers/error.ts`）**

- 用户自由作答 `actualAnswerMd` 在落 `ErrorBookEntry` 前 `redactPii` 脱敏。

> 注：`normalizedStemHash`（USER_ADHOC 去重）基于脱敏后的 stem 计算——保持一致（脱敏在 hash 之前）。

## 4. 输出侧脱敏（AI 层单一咽喉）

**`runJsonTaskWithAudit`（`packages/ai/src/audit.ts`）**

- 模型返回的**原始响应文本**在 **persist `ModelCall.responseJson` 之前 + `JSON.parse` 之前** 跑 `redactPii`。
- 一处覆盖所有走 audit 的 AI 任务（tutor / 错因 / 变式 / 作业生成 / 学习建议）。
- **JSON 安全**：占位符 `[手机号]`/`[身份证号]` 不含引号/反斜杠/花括号，落在 JSON 字符串值内仍是合法 JSON。**已知边界（接受）**：若 PII 以裸 JSON number 出现（这些文本生成任务几乎不可能——号码总在文本字段里），脱敏会破坏 JSON 结构 → 复用既有 JSON parse 失败重试/`PARSE_FAILED` 路径兜底，不另加处理。
- 若脱敏发生，记 `pii_redacted_output` 事件（类型计数，不记原值）。

## 5. 边界与一致性

- **脱敏不计费、不阻断**：纯文本变换，不抛错、不影响 charge/compensation。
- **顺序**：输入脱敏在违禁词检查（扣费前 middleware）之后、AI 调用之前；不改既有扣费/补偿语义。
- **PII 治理（Plan 6/14a）协同**：本扫描器是"写入时最小化"，与 Plan 6 的"字段级去标识化 + export/payload 守门"互补，不重叠。`OpsActionLog` payload guard 已禁手机号 regex（红线既有）——本扫描器不改 payload guard。

## 6. 测试与验收

**单元（`packages/domain/tests/pii.test.ts`）**

- 手机号：`13812345678` 命中脱敏；`手机：13812345678，备用 13900001111` 两处都脱敏；非法（`12812345678` / `1381234567`(10位) / 更长 `138123456789`(12位) 不命中）。
- 身份证：合法校验位 18 位 → 脱敏；校验位错误的 18 位 → **不**脱敏；含 `X` 校验位 → 脱敏；无关 18 位数字（如 18 位订单号、校验不过）→ 不脱敏。
- 边界：纯数学题 `求 1234567890123 的因数`（13 位连续数，非手机非身份证）→ 不命中。
- `scanPii` / `redactPii` 计数正确；**断言返回结构不含原始 PII 子串**。
- 顺序：同时含身份证（中段含 11 位数）与手机号 → 各自正确脱敏、不互相吃。

**集成**

- `tutor.ask`（`apps/web/tests/integration/`）：输入 stem 含手机号 → 持久化的 `Question.stemMd` 已脱敏（含占位、不含原号）；mock AI 适配器收到的 stem 已脱敏（断言传入参数）。
- AI 层（`packages/ai/tests/`）：mock 响应含手机号 → 持久化的 `ModelCall.responseJson` 已脱敏 + 返回的解析结果对应字段已脱敏。
- `error.diagnose`：`actualAnswerMd` 含身份证 → `ErrorBookEntry.actualAnswerMd` 已脱敏。

**CLAUDE.md 红线（落地后补）**

- PII 核纯函数：`pnpm.cmd --filter @zhijiao/domain test -- tests/pii.test.ts` 全绿；`scanPii`/`redactPii` 不返回原值。
- 输入脱敏在 AI 调用前：tutor.ask 持久化 stem + 喂 AI 文本均已脱敏。
- 输出脱敏在 AI 层咽喉：`ModelCall.responseJson` 已脱敏。

## 7. 文件清单（落地预览）

| 文件 | 动作 |
|---|---|
| `packages/domain/src/pii.ts` | 新增：`scanPii` / `redactPii` + 模式 + MOD-11 校验 |
| `packages/domain/src/index.ts` | 导出 pii API |
| `packages/domain/tests/pii.test.ts` | 新增单测 |
| `apps/web/server/routers/tutor.ts` | body 内 stem 脱敏（喂 AI + upsert 前） |
| `apps/web/server/routers/error.ts` | `actualAnswerMd` 落库前脱敏 |
| `packages/ai/src/audit.ts` | `runJsonTaskWithAudit` 原始响应脱敏（persist + parse 前） |
| 测试文件 | 单元 + 集成 |

## 8. 已知取舍

- 全占位掩码：丢失"题目本就是关于这个号码"的极少数场景的内容；接受（误伤率低 + 数据最小化优先）。
- 身份证 MOD-11 校验：增一点实现复杂度换低误伤；只覆盖 18 位（15 位旧证停发不覆盖）。
- 输出脱敏对原始 JSON 串操作：裸-number PII 边界走既有 parse 失败兜底，不特殊处理。
- 不回扫存量：历史已落库的 PII 不在本 plan 清理范围。
