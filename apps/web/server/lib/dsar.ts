// Plan 14b: DSAR service. 注意:本文件【不】import "server-only" —— 它被 tsx CLI
// (dsar:list/fulfill/reject)直接 import,server-only 的 default 导出会 throw(见
// kp-reconcile.ts / pii-governance.ts 同款先例)。server-only 只加在 routers/dsar.ts。

const SLA_WORKING_DAYS = 15;
const SLA_CALENDAR_CAP_DAYS = 30;

// 前进 n 个工作日(跳周六周日,法定节假日忽略)。UTC 维度;n=0 返回副本。
export function addWorkingDays(date: Date, n: number): Date {
  const out = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const day = out.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

// SLA 截止:15 工作日,但永不超过 +30 自然日(防长假把工作日推过 PIPL ~30 日预期)。
export function dueAtFor(requestedAt: Date): Date {
  const working = addWorkingDays(requestedAt, SLA_WORKING_DAYS);
  const cap = new Date(requestedAt.getTime() + SLA_CALENDAR_CAP_DAYS * 86_400_000);
  return working.getTime() < cap.getTime() ? working : cap;
}
