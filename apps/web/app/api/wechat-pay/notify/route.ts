import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import { applyWechatPayNotify } from "@zhijiao/billing";
import { getWechatPayAdapter } from "@/server/wechat-pay-adapter";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

// /api/wechat-pay/notify
//
// Single entry point for WeChat Pay V3 result_notify (and Mock equivalents).
// Strategy:
//   1. Unconditionally write a WechatPayEvent row (PENDING) BEFORE verify.
//      Audit is best served when even adversarial / malformed inputs leave
//      a trail. The rawBody is redacted from logs but kept in the DB row.
//   2. Adapter.verifyNotify (HMAC-SHA256 for Mock, RSA + platform cert for
//      Real once activated). On verify failure the event row is updated to
//      SIG_INVALID / CERT_NOT_FOUND / PARSE_FAILED + handled=true and we
//      still 200 to keep WeChat from retrying a junk payload forever.
//   3. applyWechatPayNotify runs the spec §4.1 state machine. We translate
//      every documented outcome (PAID / ALREADY_PAID / FAILED /
//      AMOUNT_MISMATCH / etc.) into a 200 — the only path that returns 500
//      is an unexpected exception (DB outage / P2002-with-inconsistent-DB /
//      bug) where letting WeChat retry buys us another shot once we're back.
//
// 200 vs 500 is the contract; we do NOT use 4xx because WeChat treats
// non-2xx as "retry later" and a 4xx for a valid-but-stale webhook (e.g.
// ORDER_NOT_FOUND for a webhook that arrived before our DB caught up to
// the trade-id assignment) would cause unbounded retries. Spec §4.3.

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = {
    signature: req.headers.get("Wechatpay-Signature"),
    timestamp: req.headers.get("Wechatpay-Timestamp"),
    nonce: req.headers.get("Wechatpay-Nonce"),
    serial: req.headers.get("Wechatpay-Serial"),
  };

  // Audit row first. outTradeNo is empty for now — we fill it in after
  // verify since verify is what tells us which order the payload claims.
  const event = await prisma.wechatPayEvent.create({
    data: {
      outTradeNo: "",
      rawBody,
      signature: headers.signature ?? undefined,
      timestamp: headers.timestamp ?? undefined,
      nonce: headers.nonce ?? undefined,
      serial: headers.serial ?? undefined,
      verifyStatus: "PENDING",
    },
  });

  try {
    const adapter = getWechatPayAdapter();
    const verify = await adapter.verifyNotify(headers, rawBody);
    if (!verify.ok) {
      await prisma.wechatPayEvent.update({
        where: { id: event.id },
        data: {
          verifyStatus: verify.reason,
          handled: true,
          processedAt: new Date(),
        },
      });
      logger.warn(
        {
          event: "wechat_pay_verify_failed",
          reason: verify.reason,
          eventId: event.id,
        },
        "WeChat Pay notify verify failed",
      );
      return new NextResponse("", { status: 200 });
    }

    await prisma.wechatPayEvent.update({
      where: { id: event.id },
      data: {
        verifyStatus: "OK",
        outTradeNo: verify.outTradeNo,
        transactionId: verify.transactionId,
      },
    });

    const result = await applyWechatPayNotify(
      prisma,
      verify,
      env.WECHAT_PAY_APPID ?? "",
      env.WECHAT_PAY_MCHID ?? "",
    );

    // OK-shaped terminal states: PAID / ALREADY_PAID / FAILED. Anything
    // else (MISMATCH / INTERMEDIATE / UNKNOWN / TERMINAL_STATE_CONFLICT /
    // DUPLICATE_TRANSACTION_ID / ORDER_NOT_FOUND / UNEXPECTED_REFUND) is
    // recorded as event.error for postmortem but still 200s back so
    // WeChat doesn't retry — the next webhook (or operator action) is
    // how we recover, not the retry queue.
    const isOk =
      result.kind === "PAID" ||
      result.kind === "ALREADY_PAID" ||
      result.kind === "FAILED";
    await prisma.wechatPayEvent.update({
      where: { id: event.id },
      data: {
        handled: true,
        processedAt: new Date(),
        error: isOk ? null : result.kind,
      },
    });

    // Critical anomalies that page operators if they happen in prod.
    if (
      result.kind === "AMOUNT_MISMATCH" ||
      result.kind === "APP_OR_MCH_MISMATCH"
    ) {
      logger.error(
        {
          event: "wechat_pay_critical_mismatch",
          kind: result.kind,
          outTradeNo: verify.outTradeNo,
          eventId: event.id,
        },
        "WeChat Pay critical mismatch — investigate",
      );
    } else if (result.kind === "UNEXPECTED_REFUND") {
      logger.warn(
        {
          event: "wechat_pay_unexpected_refund",
          outTradeNo: verify.outTradeNo,
          eventId: event.id,
        },
        "Refund webhook received but refunds disabled",
      );
    } else if (result.kind === "UNKNOWN_TRADE_STATE") {
      logger.warn(
        {
          event: "wechat_pay_unknown_trade_state",
          eventId: event.id,
        },
        "Unknown trade_state — V3 API upgrade?",
      );
    } else if (result.kind === "TERMINAL_STATE_CONFLICT") {
      logger.error(
        {
          event: "wechat_pay_terminal_state_conflict_route",
          outTradeNo: verify.outTradeNo,
          eventId: event.id,
        },
        "SUCCESS notify arrived for an already-FAILED order",
      );
    }

    return new NextResponse("", { status: 200 });
  } catch (e) {
    // Only the truly unexpected lands here — DB unavailable, programmer
    // bug, or a P2002 race whose re-read couldn't confirm DB consistency.
    // Returning 500 invites WeChat to retry, which is the right behaviour
    // when the failure is transient. spec §4.3.
    logger.error(
      {
        event: "wechat_pay_notify_500",
        eventId: event.id,
        error: String(e),
      },
      "applyWechatPayNotify threw — returning 500 so WeChat retries",
    );
    return new NextResponse("", { status: 500 });
  }
}
