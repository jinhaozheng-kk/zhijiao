# 微信支付 V3 真实适配器（Native 扫码）设计

> 日期：2026-06-06
> 范围：把 `RealWechatPayAdapter` 从 `NOT_IMPLEMENTED` stub 做成离线可用的真实实现。
> 状态：设计已与用户确认，待写实现计划。

## 目标

实现微信支付 V3 **Native 扫码**支付的真实适配器：商户私钥 RSA-SHA256 请求签名下单、平台证书
RSA-SHA256 验签 + APIv3 key AES-256-GCM 解密回调。**离线实现 + 离线测试锁定加密**；对真实
微信商户的 live smoke 留待真实凭证到位后单独执行。

这是「前三个真实适配器（OSS / 微信 OAuth / 阿里云短信，commit b0ff0d1）」之后、按 launch
路线图刻意延后的高风险适配器（动钱、webhook 重放、证书、幂等）。因此独立成一个专注、重审查
的 pass。

## 已确认的关键决策

1. **交易类型：Native 扫码**（`/v3/pay/transactions/native`）。理由：现有 `UnifiedOrderRequest`
   只有 `{outTradeNo, amountCents, description}`，无 openid / payer IP，Native 完美适配、无需改
   接口。JSAPI / H5 留作以后。
2. **平台证书：保持静态文件 `SingleFilePlatformCertProvider` 不变**，不做 `/v3/certificates`
   自动下载 / 轮换（留作以后）。`getBySerial(serial)` 抽象同时适配证书模式与公钥模式。
3. **verifyNotify 不做时间戳重放窗口**，防重放完全交给 billing 的 `applyWechatPayNotify` 幂等
   （按 transaction_id / out_trade_no 去重）。理由：微信对失败 notify 重试跨度达 24h，强制
   时间戳窗口会错误拒掉合法延迟重试；签名已覆盖 timestamp+nonce+body，攻击者只能重放合法
   notify，而幂等已挡住重复加款。`VerifyResult` 类型保持不变（reason 仍为
   `SIG_INVALID | CERT_NOT_FOUND | PARSE_FAILED`）。
4. **prepayId 映射：`prepayId = outTradeNo`**。Native 响应只有 `code_url`，无 prepay_id；用
   outTradeNo 作非空稳定引用，`qrCode = code_url`，`h5Url` 留空。
5. **零新依赖**：只用 Node `node:crypto`（`createSign` / `createVerify` / `createDecipheriv` /
   `X509Certificate` / `randomBytes` / `randomUUID`），契合 `@zhijiao/integrations` 既有约定。

## 不变量 / 约束（红线）

- **不改接口**：`packages/integrations/src/wechat-pay/types.ts` 不动。
- **不改装配**：`build.ts` 不动（real 模式所需 `apiV3Key + privateKey + certSerial + pubKeyFile +
  notifyHost` 已就绪，`SingleFilePlatformCertProvider` 已接好）。
- **不改消费方**：`apps/web/server/routers/wallet.ts`（topupCreate 读 `prepayId/qrCode/h5Url`、
  错误置 FAILED）与 `apps/web/app/api/wechat-pay/notify/route.ts`（按 reason 落库、ok 进 billing
  幂等状态机）行为已就绪，不动。
- **mock 仍为默认**：本实现只在 `WECHAT_PAY_USE_MOCK=false` 时生效；本地 / CI / E2E 全程走
  mock，本实现不被任何现有测试在运行期触达。
- **不发真实网络调用**：所有测试 stub `fetch` / 注入密钥，离线完成。

## 架构

仅在 `packages/integrations/src/wechat-pay/real.ts` 内落地，三块职责：

1. **请求签名 helper**（私有）：构造 V3 `Authorization` 头。
2. **`unifiedOrder`**：组下单请求 → 签名 → POST Native 端点 → 映射 / 抛错。
3. **`verifyNotify`**：取证书 → RSA 验签 → AES-GCM 解密 → 映射 `VerifyResult`。

`signalOrderReady` 保持现有 no-op（真实路径 webhook 由微信发）。

### 请求签名 helper

```
message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
signature = createSign("RSA-SHA256").update(message).sign(privateKey, "base64")
Authorization =
  `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",`
  + `signature="${signature}",timestamp="${timestamp}",serial_no="${certSerial}"`
```

- `timestamp` = `Math.floor(Date.now()/1000)` 字符串；`nonce` = `randomBytes(16).toString("hex")`
  （32 hex 字符）。**注意微信 `nonce_str` 上限 32 字符**——不可直接用带连字符的 `randomUUID()`
  （36 字符会超长）。
- `serial_no` 为**商户证书序列号**（`opts.certSerial`，对应签名用的商户私钥）。
- `urlPath` 含 path（无 query 时即 `/v3/pay/transactions/native`）。

### `unifiedOrder(req)` → Native

请求体：

```json
{
  "appid": "<appId>",
  "mchid": "<mchId>",
  "description": "<req.description>",
  "out_trade_no": "<req.outTradeNo>",
  "notify_url": "https://<notifyHost>/api/wechat-pay/notify",
  "amount": { "total": <req.amountCents>, "currency": "CNY" }
}
```

- `notify_url`：由 `opts.notifyHost` 构造。`notifyHost` 若已含 scheme 则作为 base，否则前置
  `https://`；路径固定 `/api/wechat-pay/notify`（与现有 notify route 一致）。
- POST `https://api.mch.weixin.qq.com/v3/pay/transactions/native`，头含
  `Authorization`（上方 helper）、`Accept: application/json`、`Content-Type: application/json`、
  `User-Agent`（微信要求非空 UA）。
- **成功**（HTTP 200）：响应 `{ "code_url": "weixin://wxpay/bizpayurl?pr=..." }` →
  返回 `{ prepayId: req.outTradeNo, qrCode: code_url }`（`h5Url` 不设）。
- **失败**（非 2xx）：响应 `{ "code": "...", "message": "..." }` → **throw**，错误信息含 code +
  message。（wallet.ts 的 try/catch 会捕获并把订单置 FAILED，不向客户端泄露上游细节。）

### `verifyNotify(headers, rawBody)`

`headers: NotifyHeaders = { signature, timestamp, nonce, serial }`（均可能为 null）。

1. `serial` 为空 → `{ ok:false, reason:"CERT_NOT_FOUND" }`。
2. `signature` / `timestamp` / `nonce` 任一为空 → `{ ok:false, reason:"SIG_INVALID" }`。
3. `cert = await certProvider.getBySerial(serial)`；null → `CERT_NOT_FOUND`。
4. 验签：
   ```
   message = `${timestamp}\n${nonce}\n${rawBody}\n`
   pubkey  = cert 含 "BEGIN CERTIFICATE" ? new X509Certificate(cert).publicKey : cert
   ok      = createVerify("RSA-SHA256").update(message).verify(pubkey, signature, "base64")
   ```
   false → `SIG_INVALID`。
5. 解密：解析 `rawBody` → `resource: { ciphertext, nonce, associated_data }`：
   ```
   key  = Buffer.from(apiV3Key, "utf8")            // 32 bytes
   iv   = Buffer.from(resource.nonce, "utf8")       // 12 bytes
   aad  = Buffer.from(resource.associated_data ?? "", "utf8")
   buf  = Buffer.from(resource.ciphertext, "base64")
   tag  = buf.subarray(buf.length - 16)
   data = buf.subarray(0, buf.length - 16)
   decipher = createDecipheriv("aes-256-gcm", key, iv)
   decipher.setAAD(aad); decipher.setAuthTag(tag)
   plain = Buffer.concat([decipher.update(data), decipher.final()])  // 失败抛 → PARSE_FAILED
   ```
6. 解析 `plain` → `{ out_trade_no, trade_state, amount:{total}, appid, mchid, transaction_id,
   success_time }` → 映射：
   ```
   { ok:true, outTradeNo, transactionId, tradeState, amountCents: amount.total,
     appId: appid, mchId: mchid, successTime: success_time }
   ```
   解析失败 → `PARSE_FAILED`。

> 字段映射与 `VerifyResult` ok 分支、`MockWechatPayAdapter.verifyNotify` 完全一致，保证 billing
> 侧消费无差异。

## 测试（离线，锁定加密）

新建 `packages/integrations/tests/wechat-pay-real.test.ts`。用 `generateKeyPairSync("rsa",
{ modulusLength: 2048 })` 在测试内造**商户密钥对**（私钥喂适配器签名、公钥验头签名）与**平台密钥
对**（测试私钥签 notify、公钥/证书经 stub `certProvider` 供 verifyNotify）。固定一个 32 字节
`apiV3Key`。

`unifiedOrder`：

- stub `fetch`：断言 POST 到 `…/v3/pay/transactions/native`；`Authorization` 头匹配
  `WECHATPAY2-SHA256-RSA2048` 且含 mchid / nonce_str / timestamp / serial_no / signature；body
  含 appid / mchid / out_trade_no / amount.total=amountCents / currency=CNY / notify_url。
- **签名可验**：用商户公钥对重建的 `message` 验证头里 signature 通过（端到端锁定签名规范化）。
- 成功响应 `{code_url}` → `qrCode === code_url`、`prepayId === outTradeNo`。
- 错误响应（如 HTTP 400 `{code:"PARAM_ERROR", message:"..."}`）→ `unifiedOrder` reject，错误含
  code。

`verifyNotify`：

- 合法 notify（平台私钥签 + apiV3Key AES-GCM 加密构造）→ `ok:true` 且全字段映射正确。
- 篡改 signature → `SIG_INVALID`。
- 缺 serial → `CERT_NOT_FOUND`；缺 signature → `SIG_INVALID`。
- `certProvider` 对该 serial 返 null → `CERT_NOT_FOUND`。
- 错 apiV3Key（GCM authTag 校验失败）→ `PARSE_FAILED`。
- 坏 body（验签通过但 JSON / resource 结构不对）→ `PARSE_FAILED`。
- 覆盖**证书模式 PEM**（`BEGIN CERTIFICATE`，经 `X509Certificate` 提取公钥）验签路径；同时覆盖
  **公钥模式 PEM** 直接验签路径。

> 注意：测试若用证书模式，需要一张自签 X.509 证书。可用 `node:crypto` 的 `X509Certificate` 无法
> 直接生成证书；实现计划阶段需决定生成方式（候选：用 `createPrivateKey` 导出公钥走公钥模式作为
> 主路径，证书模式用预置的自签测试证书常量，或借 `child_process` openssl）。**默认主路径用公钥
> 模式**，证书模式至少留一条用内联自签证书常量的用例。

## 验证（合并前）

- `pnpm --filter @zhijiao/integrations test`（含新 wechat-pay-real 用例）全绿。
- `pnpm exec turbo typecheck` 8/8（注意：`real.ts` 会被 web 以 DOM lib typecheck，fetch body 用
  string，无 OSS 那种 Uint8Array→BodyInit 问题；但仍需全量 typecheck 确认）。
- `pnpm exec turbo test` 8/8 不退化（mock 仍默认，消费方行为不变）。

## 明确不做（out of scope）

- JSAPI / H5 / App 支付。
- 平台证书 `/v3/certificates` 自动下载、解密、缓存、轮换。
- verifyNotify 时间戳重放窗口（交给 billing 幂等）。
- 退款 / 关单 / 查单 / 对账下载等其它 V3 接口。
- 对真实微信商户的 live smoke（见下）。

## Live smoke checklist（待真实商户凭证）

1. 配齐 `WECHAT_PAY_USE_MOCK=false` + `WECHAT_PAY_APPID / MCHID / API_V3_KEY / PRIVATE_KEY /
   CERT_SERIAL / PUB_KEY_FILE / NOTIFY_HOST`（公网可达、ICP 已过）。
2. `WECHAT_PAY_USE_MOCK=false` 下应用正常启动（env 校验通过）。
3. 发起一笔小额充值 → 前端渲染 `code_url` 二维码 → 微信扫码支付。
4. notify 命中 `/api/wechat-pay/notify` → `WechatPayEvent` 落库、verifyNotify ok。
5. 钱包余额**恰好加一次**。
6. 重放同一条 notify → 返回成功但**不重复加款**（billing 幂等）。
7. 验签失败 / 错 serial / 坏密文场景在灰度阶段各构造一次，确认分别落 SIG_INVALID /
   CERT_NOT_FOUND / PARSE_FAILED。

## 改动文件

- 改：`packages/integrations/src/wechat-pay/real.ts`
- 新增：`packages/integrations/tests/wechat-pay-real.test.ts`
- 实现完成后改：`docs/ops/public-launch-blockers.md`（WeChat Pay 那条 + 矩阵行 + 适配器顺序第 4
  项，改为"已实现离线版，待 live smoke"）。
