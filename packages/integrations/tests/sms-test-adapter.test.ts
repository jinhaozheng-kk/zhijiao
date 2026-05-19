import { describe, it, expect } from "vitest";
import { TestSmsAdapter } from "../src/sms/test.js";

describe("TestSmsAdapter", () => {
  it("latestCode 返回最近一条", async () => {
    const a = new TestSmsAdapter();
    await a.send("138", "111111");
    await a.send("138", "222222");
    expect(a.latestCode("138")).toBe("222222");
    expect(a.latestCode("139")).toBeUndefined();
  });
});
