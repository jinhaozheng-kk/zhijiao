import { describe, it, expect } from "vitest";
import { addWorkingDays, dueAtFor } from "@/server/lib/dsar";

describe("addWorkingDays", () => {
  it("周五 + 1 工作日 = 下周一", () => {
    const fri = new Date("2026-06-05T00:00:00.000Z");
    expect(addWorkingDays(fri, 1).toISOString().slice(0, 10)).toBe("2026-06-08");
  });
  it("周一 + 15 工作日 = 三周后周一", () => {
    const mon = new Date("2026-06-01T00:00:00.000Z");
    expect(addWorkingDays(mon, 15).toISOString().slice(0, 10)).toBe("2026-06-22");
  });
  it("0 工作日返回副本", () => {
    const d = new Date("2026-06-03T08:30:00.000Z");
    expect(addWorkingDays(d, 0).getTime()).toBe(d.getTime());
  });
});

describe("dueAtFor (15 工作日, 30 自然日封顶)", () => {
  it("普通情形取 15 工作日", () => {
    const mon = new Date("2026-06-01T00:00:00.000Z");
    expect(dueAtFor(mon).toISOString().slice(0, 10)).toBe("2026-06-22");
  });
  it("永不超过 +30 自然日", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");
    const cap = new Date(d.getTime() + 30 * 86400000);
    expect(dueAtFor(d).getTime()).toBeLessThanOrEqual(cap.getTime());
  });
});
