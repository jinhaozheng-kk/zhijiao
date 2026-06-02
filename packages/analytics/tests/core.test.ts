import { describe, it, expect } from "vitest";
import { aggregateMastery, scoreOf, decayWeight, tierOf } from "../src/core.js";

const kpMeta = new Map([["k1", "一元一次方程"], ["k2", "因式分解"]]);

describe("scoreOf", () => {
  it("maps grade status to score", () => {
    expect(scoreOf("CORRECT")).toBe(1);
    expect(scoreOf("PARTIAL")).toBe(0.5);
    expect(scoreOf("WRONG")).toBe(0);
  });
});

describe("decayWeight", () => {
  it("is 1 at age 0 and 0.5 at one half-life", () => {
    expect(decayWeight(0, 30)).toBeCloseTo(1);
    expect(decayWeight(30, 30)).toBeCloseTo(0.5);
  });
});

describe("tierOf", () => {
  it("returns INSUFFICIENT_DATA when weighted sample < 1", () => {
    expect(tierOf(0.9, 0.4)).toBe("INSUFFICIENT_DATA");
  });
  it("classifies by score above the data floor", () => {
    expect(tierOf(0.3, 2)).toBe("FOCUS");
    expect(tierOf(0.6, 2)).toBe("PROGRESSING");
    expect(tierOf(0.9, 2)).toBe("SOLID");
  });
});

describe("aggregateMastery", () => {
  it("computes per-KP weighted mastery and overall", () => {
    const out = aggregateMastery({
      samples: [
        { kpIds: ["k1"], gradeStatus: "CORRECT", ageDays: 0 },
        { kpIds: ["k1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["k2"], gradeStatus: "CORRECT", ageDays: 0 },
        { kpIds: ["k2"], gradeStatus: "CORRECT", ageDays: 0 },
      ],
      errors: [{ kpIds: ["k1"] }],
      kpMeta,
      halfLifeDays: 30,
    });
    expect(out.totalGradedItems).toBe(4);
    const k1 = out.masteries.find((m) => m.kpId === "k1")!;
    expect(k1.score).toBeCloseTo(0.5);
    expect(k1.tier).toBe("PROGRESSING");
    expect(k1.recentErrorCount).toBe(1);
    const k2 = out.masteries.find((m) => m.kpId === "k2")!;
    expect(k2.score).toBeCloseTo(1);
    expect(k2.tier).toBe("SOLID");
    // sort: FOCUS/PROGRESSING before SOLID
    expect(out.masteries[0]!.kpId).toBe("k1");
  });

  it("marks a KP with only a single faint old sample as INSUFFICIENT_DATA", () => {
    const out = aggregateMastery({
      samples: [{ kpIds: ["k1"], gradeStatus: "WRONG", ageDays: 120 }],
      errors: [],
      kpMeta,
      halfLifeDays: 30,
    });
    const k1 = out.masteries.find((m) => m.kpId === "k1")!;
    expect(k1.tier).toBe("INSUFFICIENT_DATA");
    expect(k1.score).toBeNull();
  });

  it("returns hasData=false when no samples", () => {
    const out = aggregateMastery({ samples: [], errors: [], kpMeta, halfLifeDays: 30 });
    expect(out.hasData).toBe(false);
    expect(out.overallScore).toBeNull();
  });
});

describe("aggregateMastery sourceWeight", () => {
  const wMeta = new Map([["kp1", "KP One"]]);

  it("down-weights a sample so it contributes less to the weighted score", () => {
    const res = aggregateMastery({
      samples: [
        { kpIds: ["kp1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["kp1"], gradeStatus: "CORRECT", ageDays: 0, sourceWeight: 0.5 },
      ],
      errors: [],
      kpMeta: wMeta,
      halfLifeDays: 30,
    });
    const m = res.masteries.find((x) => x.kpId === "kp1")!;
    expect(m.score).toBeLessThan(0.5);
    expect(m.weightedSampleSize).toBeCloseTo(1.5, 4);
  });

  it("defaults sourceWeight to 1 (existing behavior unchanged)", () => {
    const res = aggregateMastery({
      samples: [
        { kpIds: ["kp1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["kp1"], gradeStatus: "CORRECT", ageDays: 0 },
      ],
      errors: [],
      kpMeta: wMeta,
      halfLifeDays: 30,
    });
    const m = res.masteries.find((x) => x.kpId === "kp1")!;
    expect(m.score).toBeCloseTo(0.5, 4);
    expect(m.weightedSampleSize).toBeCloseTo(2, 4);
  });
});
