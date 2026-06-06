import { describe, it, expect, vi, afterEach } from "vitest";
import { RealWechatH5Adapter } from "../src/wechat/h5-oauth/real.js";
import { NotConfiguredError } from "../src/sms/types.js";

describe("RealWechatH5Adapter", () => {
  it("缺 appId/secret/redirectUri → NotConfiguredError", () => {
    expect(() => new RealWechatH5Adapter({ appId: "", secret: "x", redirectUri: "x" })).toThrow(NotConfiguredError);
  });
  it("buildAuthorizeUrl 组装出微信 OAuth URL", () => {
    const a = new RealWechatH5Adapter({ appId: "wx1", secret: "s", redirectUri: "https://x.cn/auth/wechat/callback" });
    const u = a.buildAuthorizeUrl({ state: "abc", scope: "snsapi_userinfo" });
    expect(u).toContain("open.weixin.qq.com/connect/oauth2/authorize");
    expect(u).toContain("appid=wx1");
    expect(u).toContain("state=abc");
    expect(u).toContain("#wechat_redirect");
  });

  // ──────────────────────────────────────────────
  // exchangeCodeForUser — offline tests (fetch stubbed)
  // ──────────────────────────────────────────────

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeAdapter() {
    return new RealWechatH5Adapter({
      appId: "wx_test_appid",
      secret: "test_secret",
      redirectUri: "https://example.cn/auth/wechat/callback",
    });
  }

  function stubFetch(...responses: Array<{ body: object; status?: number }>) {
    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      const r = responses[callIndex++]!;
      const body = JSON.stringify(r.body);
      return Promise.resolve({
        status: r.status ?? 200,
        text: () => Promise.resolve(body),
      });
    });
    vi.stubGlobal("fetch", mockFetch);
    return mockFetch;
  }

  // ── 1. snsapi_base 流程 ──────────────────────────────────────────────────
  it("snsapi_base: 只调 token 接口，返回 openid + unionid，不调 userinfo", async () => {
    const fetchMock = stubFetch({
      body: {
        access_token: "tok_base",
        expires_in: 7200,
        refresh_token: "ref_base",
        openid: "OPENID_BASE",
        scope: "snsapi_base",
        unionid: "UNIONID_BASE",
      },
    });

    const adapter = makeAdapter();
    const result = await adapter.exchangeCodeForUser("CODE_BASE");

    expect(result).toEqual({ openid: "OPENID_BASE", unionid: "UNIONID_BASE" });
    // userinfo endpoint must NOT have been called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // nickname / avatarUrl absent
    expect(result).not.toHaveProperty("nickname");
    expect(result).not.toHaveProperty("avatarUrl");
  });

  // ── 2. snsapi_base 无 unionid ────────────────────────────────────────────
  it("snsapi_base: token 响应无 unionid → result 不含 unionid 字段", async () => {
    stubFetch({
      body: {
        access_token: "tok_base2",
        expires_in: 7200,
        refresh_token: "ref_base2",
        openid: "OPENID_ONLY",
        scope: "snsapi_base",
      },
    });

    const result = await makeAdapter().exchangeCodeForUser("CODE_BASE2");
    expect(result).toEqual({ openid: "OPENID_ONLY" });
    expect(result).not.toHaveProperty("unionid");
  });

  // ── 3. snsapi_userinfo 流程 ──────────────────────────────────────────────
  it("snsapi_userinfo: 调 token + userinfo，映射 headimgurl→avatarUrl, nickname, openid, unionid", async () => {
    const fetchMock = stubFetch(
      {
        body: {
          access_token: "tok_info",
          expires_in: 7200,
          refresh_token: "ref_info",
          openid: "OPENID_INFO",
          scope: "snsapi_userinfo",
          unionid: "UNIONID_INFO",
        },
      },
      {
        body: {
          openid: "OPENID_INFO",
          nickname: "张三",
          sex: 1,
          headimgurl: "https://thirdwx.qlogo.cn/mmopen/abc/0",
          unionid: "UNIONID_INFO",
        },
      },
    );

    const result = await makeAdapter().exchangeCodeForUser("CODE_INFO");

    expect(result).toEqual({
      openid: "OPENID_INFO",
      unionid: "UNIONID_INFO",
      nickname: "张三",
      avatarUrl: "https://thirdwx.qlogo.cn/mmopen/abc/0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── 4. snsapi_userinfo — unionid 只在 userinfo 响应中 ────────────────────
  it("snsapi_userinfo: unionid 来自 userinfo 响应（token 无 unionid）", async () => {
    stubFetch(
      {
        body: {
          access_token: "tok_u2",
          expires_in: 7200,
          openid: "OID2",
          scope: "snsapi_userinfo",
          // no unionid in token
        },
      },
      {
        body: {
          openid: "OID2",
          nickname: "李四",
          headimgurl: "https://img.example.com/avatar.jpg",
          unionid: "UNIONID_FROM_USERINFO",
        },
      },
    );

    const result = await makeAdapter().exchangeCodeForUser("CODE_U2");
    expect(result.unionid).toBe("UNIONID_FROM_USERINFO");
    expect(result.nickname).toBe("李四");
    expect(result.avatarUrl).toBe("https://img.example.com/avatar.jpg");
  });

  // ── 5. token 接口返回 errcode → 抛错含 errcode ────────────────────────────
  it("token 接口返回 errcode:40029 → 抛出含 40029 的错误", async () => {
    stubFetch({
      body: { errcode: 40029, errmsg: "invalid code" },
    });

    await expect(makeAdapter().exchangeCodeForUser("BAD_CODE")).rejects.toThrow("40029");
  });

  // ── 6. token 接口返回非零 errcode（含 errmsg）─────────────────────────────
  it("token 接口 errcode:40163 (used code) → 抛出含 errmsg 的错误", async () => {
    stubFetch({
      body: { errcode: 40163, errmsg: "code been used" },
    });

    await expect(makeAdapter().exchangeCodeForUser("USED_CODE")).rejects.toThrow(/code been used/);
  });

  // ── 7. userinfo 接口返回 errcode → 抛错 ─────────────────────────────────
  it("userinfo 接口返回 errcode → 抛出错误", async () => {
    stubFetch(
      {
        body: {
          access_token: "tok_err",
          openid: "OID_ERR",
          scope: "snsapi_userinfo",
        },
      },
      {
        body: { errcode: 40001, errmsg: "invalid credential" },
      },
    );

    await expect(makeAdapter().exchangeCodeForUser("CODE_ERR")).rejects.toThrow("40001");
  });

  // ── 8. token 请求 URL 包含必要参数 ─────────────────────────────────────
  it("token 请求 URL 含 appid, secret, code, grant_type=authorization_code", async () => {
    const fetchMock = stubFetch({
      body: {
        access_token: "tok_url",
        openid: "OID_URL",
        scope: "snsapi_base",
      },
    });

    await makeAdapter().exchangeCodeForUser("MY_CODE");

    const calledUrl: string = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("appid=wx_test_appid");
    expect(calledUrl).toContain("secret=test_secret");
    expect(calledUrl).toContain("code=MY_CODE");
    expect(calledUrl).toContain("grant_type=authorization_code");
  });

  // ── 9. snsapi_userinfo userinfo 请求 URL 含 access_token + openid ────────
  it("userinfo 请求 URL 含 access_token + openid + lang=zh_CN", async () => {
    const fetchMock = stubFetch(
      {
        body: {
          access_token: "TOK_PARAM",
          openid: "OID_PARAM",
          scope: "snsapi_userinfo",
        },
      },
      {
        body: {
          openid: "OID_PARAM",
          nickname: "王五",
          headimgurl: "https://img.example.com/ww.jpg",
        },
      },
    );

    await makeAdapter().exchangeCodeForUser("CODE_PARAM");

    const userinfoUrl: string = fetchMock.mock.calls[1][0] as string;
    expect(userinfoUrl).toContain("access_token=TOK_PARAM");
    expect(userinfoUrl).toContain("openid=OID_PARAM");
    expect(userinfoUrl).toContain("lang=zh_CN");
  });

  // ── 10. errcode:0 视为成功（微信部分文档中出现）────────────────────────────
  it("errcode:0 视为成功，不抛错", async () => {
    stubFetch({
      body: {
        errcode: 0,
        access_token: "tok_zero",
        openid: "OID_ZERO",
        scope: "snsapi_base",
      },
    });

    const result = await makeAdapter().exchangeCodeForUser("CODE_ZERO");
    expect(result.openid).toBe("OID_ZERO");
  });
});
