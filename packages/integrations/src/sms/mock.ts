import type { SmsAdapter } from "./types.js";

export class MockSmsAdapter implements SmsAdapter {
  async send(phone: string, code: string): Promise<void> {
    // dev 控制台打码即可（仅本地）
    // eslint-disable-next-line no-console
    console.log(`[MockSms] phone=${phone} code=${code}`);
  }
}
