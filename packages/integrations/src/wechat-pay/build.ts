import type { WechatPayAdapter, NotifyMode } from "./types.js";
import { MockWechatPayAdapter } from "./mock.js";
import { RealWechatPayAdapter } from "./real.js";
import { SingleFilePlatformCertProvider } from "./platform-cert-provider.js";

export interface BuildWechatPayAdapterArgs {
  useMock: boolean;
  notifyUrl: string;
  mockSecret?: string;
  appId: string;
  mchId: string;
  notifyMode?: NotifyMode;
  apiV3Key?: string;
  privateKey?: string;
  certSerial?: string;
  pubKeyFile?: string;
  notifyHost?: string;
}

export function buildWechatPayAdapter(
  args: BuildWechatPayAdapterArgs,
): WechatPayAdapter {
  if (args.useMock) {
    if (!args.mockSecret || args.mockSecret.length < 16) {
      throw new Error(
        "buildWechatPayAdapter: mockSecret required (min 16 bytes) when useMock=true",
      );
    }
    return new MockWechatPayAdapter({
      notifyUrl: args.notifyUrl,
      mockSecret: args.mockSecret,
      appId: args.appId,
      mchId: args.mchId,
      notifyMode: args.notifyMode ?? "async-delayed",
    });
  }
  if (
    !args.apiV3Key ||
    !args.privateKey ||
    !args.certSerial ||
    !args.pubKeyFile ||
    !args.notifyHost
  ) {
    throw new Error(
      "buildWechatPayAdapter: real mode requires apiV3Key + privateKey + certSerial + pubKeyFile + notifyHost",
    );
  }
  return new RealWechatPayAdapter({
    appId: args.appId,
    mchId: args.mchId,
    apiV3Key: args.apiV3Key,
    privateKey: args.privateKey,
    certSerial: args.certSerial,
    notifyHost: args.notifyHost,
    certProvider: new SingleFilePlatformCertProvider(
      args.certSerial,
      args.pubKeyFile,
    ),
  });
}
