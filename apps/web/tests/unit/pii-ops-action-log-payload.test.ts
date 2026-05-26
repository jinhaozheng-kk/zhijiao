import { describe, expect, it } from "vitest";

const FORBIDDEN_TEXT =
  /(?:\b1[3-9]\d{9}\b|openid|unionid|wx_|rawBody|stemMd|actualAnswerMd|requestJson|responseJson|ipCreated|userAgent|outPath|[A-Za-z]:\\|\/tmp\/)/i;

const ROOT_KEYS: Record<string, string[]> = {
  DEACTIVATE_USER: ["deleted", "dryRun", "scrubbed"],
  EXPORT_USER_DATA: ["exportSizeBytes", "outputWritten", "recordCounts"],
  GC_SWEEP_SHORT: ["results"],
  GC_SWEEP_MEDIUM: ["results"],
  GC_SWEEP_ORPHAN: ["results"],
};

function assertPayloadSafe(kind: keyof typeof ROOT_KEYS, payload: unknown) {
  expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual(ROOT_KEYS[kind]);
  expect(JSON.stringify(payload)).not.toMatch(FORBIDDEN_TEXT);
}

describe("OpsActionLog payload guardrails", () => {
  it("allows only non-PII deactivate payload summary fields", () => {
    assertPayloadSafe("DEACTIVATE_USER", {
      scrubbed: {
        sessions: 1,
        topupOrders: 1,
        modelCalls: 1,
        kpAliases: 1,
        kpReconcileMatches: 1,
        variantGeneratedQuestions: 1,
        authIdentities: 1,
        otpRequests: 1,
      },
      deleted: {
        errorBookEntries: 1,
        variantGroups: 1,
        variantItems: 1,
        userAdhocQuestions: 1,
      },
      dryRun: false,
    });
  });

  it("allows only non-PII export payload summary fields", () => {
    assertPayloadSafe("EXPORT_USER_DATA", {
      exportSizeBytes: 2048,
      outputWritten: true,
      recordCounts: {
        authIdentities: 1,
        creditLedger: 1,
        topupOrders: 1,
        errorBookEntries: 1,
        userAdhocQuestions: 1,
        modelCalls: 1,
      },
    });
  });

  it("allows only non-PII GC result payload summary fields", () => {
    assertPayloadSafe("GC_SWEEP_SHORT", {
      results: [
        { bucket: "short", table: "otp_requests", affected: 2, dryRun: false, hasMore: false },
        { bucket: "short", table: "sessions", affected: 1, dryRun: false, hasMore: false },
      ],
    });
    assertPayloadSafe("GC_SWEEP_MEDIUM", {
      results: [
        { bucket: "medium", table: "wechat_pay_events", affected: 1, dryRun: false, hasMore: false },
        { bucket: "medium", table: "topup_orders", affected: 1, dryRun: false, hasMore: false },
      ],
    });
    assertPayloadSafe("GC_SWEEP_ORPHAN", {
      results: [
        { bucket: "orphan", table: "topup_orders", affected: 1, dryRun: false, hasMore: false },
      ],
    });
  });

  it("rejects common PII and local output path leaks", () => {
    expect(() =>
      assertPayloadSafe("EXPORT_USER_DATA", {
        exportSizeBytes: 1,
        outputWritten: true,
        recordCounts: {},
        outPath: "D:\\tmp\\export.json",
      }),
    ).toThrow();
    expect(() =>
      assertPayloadSafe("DEACTIVATE_USER", {
        scrubbed: { phone: "13800000000" },
        deleted: {},
        dryRun: false,
      }),
    ).toThrow();
    expect(() =>
      assertPayloadSafe("GC_SWEEP_MEDIUM", {
        results: [{ table: "wechat_pay_events", rawBody: "<xml>wx_secret</xml>" }],
      }),
    ).toThrow();
  });
});
