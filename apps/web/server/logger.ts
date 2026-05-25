import "server-only";
import pino, { type Logger } from "pino";
import { setBillingLogger } from "@zhijiao/billing";
import { setKpReconcileLogger } from "./lib/kp-reconcile.js";
import { env } from "./env.js";

// Module-singleton pino. Imported once anywhere in the server bundle, the
// side effect below also injects this logger into @zhijiao/billing so that
// applyWechatPayNotify / chargedProcedure log into the same stream as the
// rest of the server (rather than the package's default noop).
export const logger: Logger = pino({
  level: env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      // Auth surface
      "req.headers.cookie",
      "req.headers.authorization",
      // WeChat Pay surface — anything carrying signed bodies / signatures
      // should not land in logs verbatim.
      "*.rawBody",
      "*.signature",
    ],
    censor: "[redacted]",
  },
});

setBillingLogger({
  error: (obj, msg) => logger.error(obj, msg),
  warn: (obj, msg) => logger.warn(obj, msg),
  info: (obj, msg) => logger.info(obj, msg),
});

// Plan 9 Task 5 hotfix (review P1): kp-reconcile.ts has no server-only / direct
// logger import so CLI scripts (kp:review / kp:reconcile-pending / kp-backfill-
// variant-items) can tsx-import the same service module. We inject the server
// logger here at module load. CLIs that import kp-reconcile directly without
// going through this logger.ts will fall back to the no-op default — that's
// fine, the script's own console.error will still show top-level failures.
setKpReconcileLogger({
  warn: (obj, msg) => logger.warn(obj, msg),
});
