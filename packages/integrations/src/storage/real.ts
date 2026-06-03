import type { StorageAdapter } from "./types.js";

export interface OssOpts {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint: string;
}

// Real Aliyun OSS adapter — stub until ICP 备案 + bucket configured (mirrors the
// WeChat-pay real stub). Activated post-launch in its own plan.
export class AliyunOssAdapter implements StorageAdapter {
  constructor(private opts: OssOpts) {}
  async put(_key: string, _bytes: Uint8Array, _contentType: string): Promise<void> {
    throw new Error("AliyunOssAdapter.put NOT_IMPLEMENTED (activate post-ICP)");
  }
  async getBytes(_key: string): Promise<Uint8Array | null> {
    throw new Error("AliyunOssAdapter.getBytes NOT_IMPLEMENTED (activate post-ICP)");
  }
}
