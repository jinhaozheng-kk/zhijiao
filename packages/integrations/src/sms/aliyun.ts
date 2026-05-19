import { NotConfiguredError, type SmsAdapter } from "./types.js";

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

export class AliyunSmsAdapter implements SmsAdapter {
  constructor(private cfg: AliyunSmsConfig) {
    for (const k of ["accessKeyId","accessKeySecret","signName","templateCode"] as const) {
      if (!cfg[k]) throw new NotConfiguredError(`AliyunSmsAdapter.${k}`);
    }
  }
  async send(_phone: string, _code: string): Promise<void> {
    // 真接阿里云 SMS 留 Plan 2 之后；先抛"未实现"以防误以为生效。
    throw new Error("AliyunSmsAdapter.send not implemented yet — set SMS_USE_MOCK=true for dev");
  }
}
