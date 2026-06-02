import { MockStorageAdapter, sharedMockStorageAdapter } from "./mock.js";
import { AliyunOssAdapter } from "./real.js";
import type { StorageAdapter } from "./types.js";

export function buildStorageAdapter(env: NodeJS.ProcessEnv): StorageAdapter {
  // Shared in-process mock under test / E2E so the upload route and the AI read
  // see the same bytes within one process.
  if (env.NODE_ENV === "test" || env.E2E_TEST_HOOKS === "1") {
    return sharedMockStorageAdapter;
  }
  if (env.STORAGE_USE_MOCK === "true") return new MockStorageAdapter();
  return new AliyunOssAdapter({
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID ?? "",
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET ?? "",
    bucket: env.ALIYUN_OSS_BUCKET ?? "",
    region: env.ALIYUN_OSS_REGION ?? "",
    endpoint: env.ALIYUN_OSS_ENDPOINT ?? "",
  });
}
