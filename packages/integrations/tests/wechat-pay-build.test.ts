import { describe, it, expect } from "vitest";
import { buildWechatPayAdapter } from "../src/wechat-pay/build.js";
import { MockWechatPayAdapter } from "../src/wechat-pay/mock.js";

describe("buildWechatPayAdapter", () => {
  it("useMock=true + secret returns MockWechatPayAdapter", () => {
    const a = buildWechatPayAdapter({
      useMock: true,
      notifyUrl: "http://x/notify",
      mockSecret: "x".repeat(16),
      appId: "app",
      mchId: "mch",
    });
    expect(a).toBeInstanceOf(MockWechatPayAdapter);
  });

  it("useMock=true without secret throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: true,
        notifyUrl: "http://x/notify",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/mockSecret required/);
  });

  it("useMock=true with short secret throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: true,
        notifyUrl: "http://x/notify",
        mockSecret: "short",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/min 16 bytes/);
  });

  it("useMock=false without real fields throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: false,
        notifyUrl: "http://x/notify",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/real mode requires/);
  });
});
