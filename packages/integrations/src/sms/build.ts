import { MockSmsAdapter } from "./mock.js";
import { sharedTestSmsAdapter } from "./test.js";
import { AliyunSmsAdapter } from "./aliyun.js";
import type { SmsAdapter } from "./types.js";

export function buildSmsAdapter(env: NodeJS.ProcessEnv): SmsAdapter {
  if (env.NODE_ENV === "test") return sharedTestSmsAdapter;
  if (env.SMS_USE_MOCK === "true") return new MockSmsAdapter();
  return new AliyunSmsAdapter({
    accessKeyId:     env.ALIYUN_SMS_ACCESS_KEY_ID     ?? "",
    accessKeySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? "",
    signName:        env.ALIYUN_SMS_SIGN_NAME         ?? "",
    templateCode:    env.ALIYUN_SMS_TEMPLATE_CODE     ?? "",
  });
}
