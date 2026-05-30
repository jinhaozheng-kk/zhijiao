import { describe, it, expect } from "vitest";
import { scanPii, redactPii } from "../src/pii.js";

// MOD-11 有效身份证测试号。440524198001010013（出生 1980-01-01，校验位 3）
// 算法验证后选定：原 440524188001010014 出生年 1880 被正则 (?:19|20) 段拒收，故换样例。
const VALID_ID2 = "440524198001010013";

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
  it("10/12 位 / 12 开头不命中", () => {
    expect(redactPii("1381234567").hits.phone).toBe(0);
    expect(redactPii("138123456789").hits.phone).toBe(0);
    expect(redactPii("12812345678").hits.phone).toBe(0);
  });
  it("13 位连续数字不命中", () => {
    expect(redactPii("求 1234567890123 的因数").hits.phone).toBe(0);
  });
});

describe("redactPii 身份证", () => {
  it("校验通过的 18 位脱敏", () => {
    const r = redactPii(`身份证 ${VALID_ID2} 就这些`);
    expect(r.redacted).toContain("[身份证号]");
    expect(r.redacted).not.toContain(VALID_ID2);
    expect(r.hits.idCard).toBe(1);
  });
  it("校验位错误的 18 位不脱敏", () => {
    const bad = "440524198001010011";
    const r = redactPii(`编号 ${bad}`);
    expect(r.hits.idCard).toBe(0);
    expect(r.redacted).toContain(bad);
  });
});

describe("顺序 / 不互吃 / 安全", () => {
  it("同时含身份证与手机号各自脱敏", () => {
    const r = redactPii(`证 ${VALID_ID2} 机 13812345678`);
    expect(r.hits).toEqual({ phone: 1, idCard: 1 });
    expect(r.redacted).toBe("证 [身份证号] 机 [手机号]");
  });
  it("scanPii 返回计数", () => {
    expect(scanPii(`${VALID_ID2} 13812345678`)).toEqual({ phone: 1, idCard: 1 });
  });
  it("返回结构不含原始 PII 子串", () => {
    expect(JSON.stringify(redactPii("13812345678"))).not.toContain("13812345678");
  });
  it("空字符串原样", () => {
    expect(redactPii("").redacted).toBe("");
  });
});
