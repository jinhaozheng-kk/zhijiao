# @zhijiao/billing

智教 Credit 余额账务系统。Wallet / Ledger / 充值 / 扣点 / 补偿 / OPS 调账。

## 账务红线（**勿越**）

1. **`Wallet.balance` 的修改一律走 `chargeForAction` / `compensate` / `applyWechatPayNotify` / `adminAdjust`**。禁止任何工具（Prisma Studio / psql / 一次性脚本 / DB GUI）直接 `UPDATE wallets SET balance = ...`——会绕过 ledger 永久断对账。
2. **任何写 ledger 必须先想清 `idemKey`**（`topup:${outTradeNo}` / `debit:${kind}:${userId}:${clientRequestId}` / `comp:${originalLedgerId}` / OPS 显式）。写不出来 = schema 设计错。
3. **`balanceAfter` snapshot 是对账依据**：最新 ledger entry 的 `balanceAfter` 必须 == `wallets.balance`，不一致即事务边界 bug。
4. **OPS 调账走 `wallet.walletAdminAdjust` procedure** 或 `adminAdjust(prisma, {...})` 一次性脚本；不走任何 ad-hoc SQL。

详见 spec `docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md` §3 / §5。
