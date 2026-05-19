import { describe, it, expect } from "vitest";
import { AliyunSmsAdapter } from "../src/sms/aliyun.js";
import { NotConfiguredError } from "../src/sms/types.js";

describe("AliyunSmsAdapter", () => {
  it("缺 key 抛 NotConfiguredError", () => {
    expect(() => new AliyunSmsAdapter({ accessKeyId: "", accessKeySecret: "x", signName: "x", templateCode: "x" }))
      .toThrow(NotConfiguredError);
  });
  it("send 当前未实现（提示性错误）", async () => {
    const a = new AliyunSmsAdapter({ accessKeyId: "a", accessKeySecret: "b", signName: "c", templateCode: "d" });
    await expect(a.send("138", "111111")).rejects.toThrow(/not implemented/);
  });
});
