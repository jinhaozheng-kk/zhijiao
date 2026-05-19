import type { SmsAdapter } from "./types.js";

export class TestSmsAdapter implements SmsAdapter {
  private store = new Map<string, string[]>();

  async send(phone: string, code: string): Promise<void> {
    const list = this.store.get(phone) ?? [];
    list.push(code);
    this.store.set(phone, list);
  }

  /** 测试 helper：取该手机号最近一条 code */
  latestCode(phone: string): string | undefined {
    const list = this.store.get(phone);
    return list?.[list.length - 1];
  }

  reset() { this.store.clear(); }
}

/** Process 单例：apps/web 在 SMS_USE_MOCK + NODE_ENV=test 时挂这个 */
export const sharedTestSmsAdapter = new TestSmsAdapter();
