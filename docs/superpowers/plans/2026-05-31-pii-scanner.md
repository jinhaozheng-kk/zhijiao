# 通用 PII 扫描器（落库前脱敏）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在自由文本写入边界脱敏手机号 / 身份证：用户输入（tutor 题面、error 自由作答）在发 LLM 前 + 落库前脱敏，AI 输出在 AI 层咽喉持久化 + 解析前脱敏。

**Architecture:** 纯函数检测/脱敏核 `packages/domain/src/pii.ts`（手机号数字边界正则 + 身份证结构化正则 & MOD-11 校验，全占位掩码，只返类型计数不返原值）。输入侧在 `tutor.ask` / `error.diagnose` body 内 `redactPii`（喂 AI + 持久化同用脱敏文本）。输出侧在 `runJsonTaskWithAudit` 对 `response.content` 脱敏（parse + writeAudit 之前，一处覆盖所有 AI 任务）。

**Tech Stack:** TypeScript（纯函数 + 正则）、tRPC v11、`@zhijiao/ai`（已依赖 `@zhijiao/domain`，无循环）、Vitest。

**Spec:** `docs/superpowers/specs/2026-05-31-pii-scanner-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/domain/src/pii.ts` | 新增：`scanPii` / `redactPii` + 模式 + MOD-11 校验（纯函数，零依赖） |
| `packages/domain/src/index.ts` | 导出 pii API |
| `packages/domain/tests/pii.test.ts` | 纯单测 |
| `packages/ai/src/router.ts` | `runJsonTaskWithAudit` 对 `response.content` 脱敏（parse + writeAudit 前） |
| `packages/ai/tests/pii-redaction.test.ts` | AI 输出脱敏集成 |
| `apps/web/server/routers/tutor.ts` | body 内 stem 脱敏（喂 AI + upsert 前） |
| `apps/web/server/routers/error.ts` | `actualAnswerMd` 脱敏（喂 AI + 持久化前） |
| `apps/web/tests/integration/pii-redaction-input.test.ts` | tutor / error 输入脱敏集成 |

---

## Task 1: PII 检测/脱敏核（纯函数 + 单测）

**Files:**
- Create: `packages/domain/src/pii.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/pii.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/domain/tests/pii.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanPii, redactPii } from "../src/pii.js";

// 合法身份证（MOD-11 校验通过）。构造：110101 19900307 174 + 校验位。
// 校验位算法见实现；此号校验位为 "8"（110101199003071758 ... 用真实有效号）。
const VALID_ID = "11010119900307741X"; // 末位 X，结构化 + 校验通过的样例
const VALID_ID2 = "440524188001010014"; // 经典有效样例（校验位 4）

describe("redactPii 手机号", () => {
  it("单个手机号脱敏", () => {
    const r = redactPii("联系我 13812345678 谢谢");
    expect(r.redacted).toBe("联系我 [手机号] 谢谢");
    expect(r.hits.phone).toBe(1);
  });
  it("多个手机号都脱敏", () => {
    const r = redactPii("13812345678 和 13900001111");
    expect(r.redacted).toBe("[手机号] 和 [手机号]");
    expect(r.hits.phone).toBe(2);
  });
  it("10 位 / 12 位 / 12 开头不命中", () => {
    expect(redactPii("1381234567").hits.phone).toBe(0);   // 10 位
    expect(redactPii("138123456789").hits.phone).toBe(0); // 12 位（数字边界）
    expect(redactPii("12812345678").hits.phone).toBe(0);  // 第二位非 3-9
  });
  it("13 位连续数学数字不命中", () => {
    expect(redactPii("求 1234567890123 的因数").hits.phone).toBe(0);
  });
});

describe("redactPii 身份证", () => {
  it("校验通过的 18 位脱敏", () => {
    const r = redactPii(`我的身份证 ${VALID_ID2} 就这些`);
    expect(r.redacted).toContain("[身份证号]");
    expect(r.redacted).not.toContain(VALID_ID2);
    expect(r.hits.idCard).toBe(1);
  });
  it("末位 X 的有效号脱敏", () => {
    expect(redactPii(VALID_ID).hits.idCard).toBe(1);
  });
  it("校验位错误的 18 位数不脱敏", () => {
    const bad = "440524188001010011"; // 改末位 → 校验失败
    const r = redactPii(`编号 ${bad}`);
    expect(r.hits.idCard).toBe(0);
    expect(r.redacted).toContain(bad);
  });
});

describe("redactPii 顺序 / 不互吃", () => {
  it("同时含身份证与手机号各自脱敏", () => {
    const r = redactPii(`证 ${VALID_ID2} 机 13812345678`);
    expect(r.hits.idCard).toBe(1);
    expect(r.hits.phone).toBe(1);
    expect(r.redacted).toBe("证 [身份证号] 机 [手机号]");
  });
});

describe("scanPii / 安全", () => {
  it("scanPii 返回计数", () => {
    expect(scanPii(`${VALID_ID2} 13812345678`)).toEqual({ phone: 1, idCard: 1 });
  });
  it("返回结构不含原始 PII 子串", () => {
    const r = redactPii("13812345678");
    expect(JSON.stringify(r)).not.toContain("13812345678");
  });
  it("空 / 非 string 原样", () => {
    expect(redactPii("").redacted).toBe("");
  });
});
```

> 注：`VALID_ID`/`VALID_ID2` 必须是 MOD-11 真有效号。实现 Step 后若某样例校验不过，**改样例为真有效号**（用实现的算法验证），不要改算法迁就坏样例。`440524188001010014` 是公认有效测试号。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/domain test -- tests/pii.test.ts`
Expected: FAIL — Cannot find module '../src/pii.js'

- [ ] **Step 3: 实现 `packages/domain/src/pii.ts`**

```ts
// 通用 PII 检测/脱敏（手机号 + 身份证）。纯函数、零依赖。
// 全占位掩码；只返类型计数，绝不返回命中的原始值（防 PII 流进日志/审计）。

// 手机号：数字边界，避免命中更长数字串中段。
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
// 身份证 18 位：6 位地区 + 19/20 世纪年 + 合法月日 + 3 位序 + 校验位(0-9 或 X)。
const ID_RE = /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;

// GB 11643-1999 MOD-11-2 校验位。
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

function isValidIdChecksum(id: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * ID_WEIGHTS[i]!;
  return ID_CHECK_CODES[sum % 11] === id[17]!.toUpperCase();
}

export interface PiiHits {
  phone: number;
  idCard: number;
}

// 脱敏：先身份证（更长更具体）后手机号。校验位失败的 18 位数不脱敏。
export function redactPii(text: string): { redacted: string; hits: PiiHits } {
  if (typeof text !== "string" || text.length === 0) {
    return { redacted: text, hits: { phone: 0, idCard: 0 } };
  }
  let idCard = 0;
  let redacted = text.replace(ID_RE, (m) => {
    if (isValidIdChecksum(m)) {
      idCard++;
      return "[身份证号]";
    }
    return m; // 校验失败 → 不脱敏，避免误伤无关长数字
  });
  let phone = 0;
  redacted = redacted.replace(PHONE_RE, () => {
    phone++;
    return "[手机号]";
  });
  return { redacted, hits: { phone, idCard } };
}

// 仅检测计数（复用 redactPii，DRY）。
export function scanPii(text: string): PiiHits {
  return redactPii(text).hits;
}
```

在 `packages/domain/src/index.ts` 末尾加：
```ts
export * from "./pii.js";
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/domain test -- tests/pii.test.ts`
Expected: PASS（全绿）。若样例号校验不过，按 Step 1 注释改成真有效号。

- [ ] **Step 5: typecheck + 提交**

Run: `pnpm.cmd --filter @zhijiao/domain typecheck` → PASS
```bash
git add packages/domain/src/pii.ts packages/domain/src/index.ts packages/domain/tests/pii.test.ts
git commit -m "feat(domain): PII scanner (phone + ID-card MOD-11) scanPii/redactPii"
```

---

## Task 2: AI 输出脱敏（runJsonTaskWithAudit 咽喉）

**Files:**
- Modify: `packages/ai/src/router.ts`（`runJsonTaskWithAudit`，adapter 调用后、`JSON.parse` 前）
- Test: `packages/ai/tests/pii-redaction.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/ai/tests/pii-redaction.test.ts`：参考 `packages/ai/tests/router.test.ts` 的 mock adapter + prisma 构造方式。核心：

```ts
// 用一个 mock adapter 返回 content 含手机号的合法 JSON（字段值里），跑一个真实 task（如 tutor）。
// 断言：
//   1) 返回的解析结果对应字段值已变成 [手机号]（不含原号）。
//   2) 持久化的 ModelCall.responseJson.content 已脱敏（query 最近一条 modelCall）。
// mock adapter.call 返回 { content: JSON.stringify({...含 "13812345678" 的文本字段...}), model, tokensIn, tokensOut }。
```

> 实现者：以 `packages/ai/tests/router.test.ts` 为模板（同样的 RouterOptions / mock adapter / testPrisma）。选一个字段会进 content 的 task。断言对应字段 + ModelCall.responseJson。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/ai test -- tests/pii-redaction.test.ts`
Expected: FAIL（输出未脱敏）。

- [ ] **Step 3: 实现脱敏**

`packages/ai/src/router.ts`：顶部 import：
```ts
import { redactPii } from "@zhijiao/domain";
```
在 `runJsonTaskWithAudit` 的重试循环里，`response = await this.opts.adapter.call(args.request);` 之后、`const json = JSON.parse(response.content);` 之前，插入：
```ts
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（覆盖所有 AI 任务）。
        // 占位符不含引号/括号，落在 JSON 字符串值内仍合法；裸-number PII（罕见）走既有 parse 失败兜底。
        response.content = redactPii(response.content).redacted;
```
这样 `JSON.parse(response.content)`、`args.schema.parse`、以及后续 `writeAudit(..., response, ...)` 全用脱敏后的 content。

- [ ] **Step 4: 运行确认通过 + AI 回归**

Run: `pnpm.cmd --filter @zhijiao/ai test -- tests/pii-redaction.test.ts` → PASS
Run: `pnpm.cmd --filter @zhijiao/ai test` → 全 PASS（脱敏不破坏既有 task；既有 mock 响应不含 PII 故不变）。

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/router.ts packages/ai/tests/pii-redaction.test.ts
git commit -m "feat(ai): redact PII from model response before parse + audit persist"
```

---

## Task 3: tutor.ask 输入脱敏

**Files:**
- Modify: `apps/web/server/routers/tutor.ts`
- Test: `apps/web/tests/integration/pii-redaction-input.test.ts`（本任务建，含 tutor 用例；Task 4 追加 error 用例）

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/pii-redaction-input.test.ts`：参考 `apps/web/tests/integration/kp-reconcile-sync-tutor-ask.test.ts` 或既有 tutor 集成测试的 caller/ctx 构造 + mock AI。tutor 用例：

```ts
// 学生调 tutor.ask({ questionStem: "我手机13812345678，解方程 2x+5=13", clientRequestId })。
// 断言：
//   1) 持久化的 USER_ADHOC Question.stemMd 已脱敏（含 [手机号]，不含原号）。
//   2) 传给 AI adapter 的 stem 已脱敏（spy/mock adapter 记录入参，或经 mock 行为间接断言）。
```

> mock AI 走既有 MockAdapter（tutor 关键词默认返值）。断言 Question.stemMd：query `prisma.question.findFirst({ where: { createdByUserId, source: "USER_ADHOC" } })`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-redaction-input.test.ts`
Expected: FAIL（stem 未脱敏）。

- [ ] **Step 3: 实现**

`apps/web/server/routers/tutor.ts`：顶部 import：
```ts
import { redactPii } from "@zhijiao/domain";
```
在 mutation body 开头（`const { clientRequestId: _clientRequestId, ...aiInput } = input;` 之后、AI 调用之前）脱敏，并用脱敏文本喂 AI 与 upsert：
```ts
      const { redacted: redactedStem, hits: piiHits } = redactPii(input.questionStem);
      if (piiHits.phone > 0 || piiHits.idCard > 0) {
        logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK", hits: piiHits });
      }
      aiInput.questionStem = redactedStem;
```
并把 upsert 的 stem 改为脱敏后：
```ts
      const question = await upsertUserAdhocQuestion(ctx.db, {
        userId: ctx.auth.userId,
        stemMd: redactedStem,
      });
```
（`aiInput.questionStem = redactedStem` 确保 `getAiRouter(...).tutor(aiInput)` 收到脱敏文本。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-redaction-input.test.ts`
Expected: PASS（tutor 用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/routers/tutor.ts apps/web/tests/integration/pii-redaction-input.test.ts
git commit -m "feat(web): redact PII from tutor.ask stem before AI + persist"
```

---

## Task 4: error.diagnose 输入脱敏

**Files:**
- Modify: `apps/web/server/routers/error.ts`
- Test: `apps/web/tests/integration/pii-redaction-input.test.ts`（追加 error 用例）

- [ ] **Step 1: 追加失败测试**

在 `pii-redaction-input.test.ts` 追加 error 用例：

```ts
// 学生对一道自有 USER_ADHOC question 调 error.diagnose({ questionId, actualAnswerMd: "我身份证 440524188001010014 算错了", clientRequestId })。
// 断言：持久化的 ErrorBookEntry.actualAnswerMd 已脱敏（含 [身份证号]，不含原号）。
```

> 参考 `tests/integration/error-diagnose-question-access.test.ts` 构造自有 question + caller。mock AI 走 MockAdapter（错因关键词默认返值）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-redaction-input.test.ts`
Expected: error 用例 FAIL。

- [ ] **Step 3: 实现**

`apps/web/server/routers/error.ts`：顶部 import `import { redactPii } from "@zhijiao/domain";`。在 `diagnose` body 内、AI 调用之前，脱敏一次并复用：
```ts
      const redactedActualAnswer = input.actualAnswerMd
        ? redactPii(input.actualAnswerMd).redacted
        : null;
```
把 AI 调用入参（原 `actualAnswerMd: input.actualAnswerMd ?? null`）改为 `actualAnswerMd: redactedActualAnswer`；把持久化入参（原 `actualAnswerMd: input.actualAnswerMd ?? null`）改为 `actualAnswerMd: redactedActualAnswer`。两处都用脱敏后的值。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-redaction-input.test.ts`
Expected: PASS（tutor + error 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/routers/error.ts apps/web/tests/integration/pii-redaction-input.test.ts
git commit -m "feat(web): redact PII from error.diagnose actualAnswerMd before AI + persist"
```

---

## Task 5: 全量验证 + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: regenerate（无 schema 变更，保险）+ 全量 typecheck/test**

Run:
```
pnpm.cmd exec turbo typecheck test --force
```
Expected: 全 PASS（16 tasks 全绿）。

- [ ] **Step 2: 负向探针 — 确认 AI 咽喉脱敏真生效**

Run: `pnpm.cmd --filter @zhijiao/ai test -- tests/pii-redaction.test.ts` → PASS（已在 Task 2）；并人工确认 `Select-String -Path packages/ai/src/router.ts -Pattern "redactPii"` 命中且在 `JSON.parse` 之前。

- [ ] **Step 3: 更新 CLAUDE.md**

在「已落地」列表加 Plan 14c 条目；加「PII 扫描器现状（Plan 14c）」段（pii.ts 纯核 phone+身份证 MOD-11、全占位、只返计数；输入侧 tutor/error body 脱敏喂 AI+落库前；输出侧 runJsonTaskWithAudit 咽喉；不阻断/不回扫存量）；「Merge 后必跑」加红线：
- PII 核单测：`pnpm.cmd --filter @zhijiao/domain test -- tests/pii.test.ts` 全绿；`redactPii`/`scanPii` 不返原值。
- 输入脱敏在 AI 前：`Select-String -Path apps/web/server/routers/tutor.ts,apps/web/server/routers/error.ts -Pattern "redactPii"` 命中；`pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-redaction-input.test.ts` 全绿。
- 输出脱敏在 AI 咽喉：`Select-String -Path packages/ai/src/router.ts -Pattern "redactPii"` 命中、在 `JSON.parse` 前；`pnpm.cmd --filter @zhijiao/ai test -- tests/pii-redaction.test.ts` 全绿。
从「下一步候选 Plan」移除 Plan 14c（已落地；14b 仍待）。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 14c PII scanner landed"
```

---

## Self-Review 记录

- **Spec coverage**：§2 检测核→Task 1；§3 输入侧（tutor + error）→Task 3/4；§4 输出侧 AI 咽喉→Task 2；§6 测试→各 Task + Task 5；§5 边界（不阻断/不计费）由"纯文本变换不抛错"天然满足，集成测试间接覆盖。无缺口。
- **Placeholder scan**：Task 2/3/4 的集成测试以"参考既有 X 测试构造"指引而非贴全 mock-adapter/caller 样板（那是既有大段样板，贴全易过时），但断言清单确切、指向单一真源模板文件。实现代码步骤均含完整代码。pii.ts / router.ts 改动为完整代码。
- **Type consistency**：`redactPii`（返 `{ redacted, hits:{phone,idCard} }`）/ `scanPii`（返 `PiiHits`）/ `PiiHits` 跨 Task 1→2→3→4 一致；占位符 `[手机号]`/`[身份证号]` 字面值跨任务一致；`response.content` 字段名与 router.ts 现状（`JSON.parse(response.content)`）一致。
- **校验样例**：MOD-11 测试号若实现后校验不过，改样例不改算法（Step 1/4 已注明）。
