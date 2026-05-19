import { describe, it, expect, vi } from "vitest";
import { MockSmsAdapter } from "../src/sms/mock.js";

describe("MockSmsAdapter", () => {
  it("send 走 console.log 不抛", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new MockSmsAdapter().send("138", "123456");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
