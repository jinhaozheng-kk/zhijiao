export interface WechatH5UserInfo {
  openid: string;
  unionid?: string;
  nickname?: string;
  avatarUrl?: string;
}

export interface WechatH5Adapter {
  /** 返 OAuth authorize URL，参数已含 appId/redirect_uri/state/scope */
  buildAuthorizeUrl(opts: { state: string; scope: "snsapi_base" | "snsapi_userinfo" }): string;
  /** 用 code 换 access_token + openid + (可选 userinfo) */
  exchangeCodeForUser(code: string): Promise<WechatH5UserInfo>;
  /** 当前 appId（用于 AuthIdentity.providerScope） */
  readonly appId: string;
}
