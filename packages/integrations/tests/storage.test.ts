import { describe, it, expect } from "vitest";
import { MockStorageAdapter } from "../src/storage/mock.js";
import { buildStorageAdapter } from "../src/storage/build.js";
import { AliyunOssAdapter } from "../src/storage/real.js";

describe("MockStorageAdapter", () => {
  it("roundtrips bytes by key", async () => {
    const s = new MockStorageAdapter();
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put("adhoc/u1/a.png", bytes, "image/png");
    expect(await s.getBytes("adhoc/u1/a.png")).toEqual(bytes);
    expect(await s.getBytes("missing")).toBeNull();
  });
});

describe("buildStorageAdapter", () => {
  it("returns the mock under test env", () => {
    const s = buildStorageAdapter({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(MockStorageAdapter);
  });
  it("returns the mock when STORAGE_USE_MOCK=true", () => {
    const s = buildStorageAdapter({
      STORAGE_USE_MOCK: "true",
    } as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(MockStorageAdapter);
  });
  it("real adapter throws NOT_IMPLEMENTED until OSS is configured", async () => {
    const real = new AliyunOssAdapter({
      accessKeyId: "",
      accessKeySecret: "",
      bucket: "",
      region: "",
      endpoint: "",
    });
    await expect(real.getBytes("k")).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
