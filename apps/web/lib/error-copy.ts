export function copyForReason(reason: string | null | undefined): string {
  if (reason === "INSUFFICIENT_BALANCE") return "余额不足，请先为钱包充值后再继续。";
  if (reason === "GUARDIAN_CONSENT_REQUIRED") return "需要监护人同意后才能继续使用。";
  if (reason === "NO_SESSION") return "请先登录后再继续。";
  if (reason === "PERMISSION_DENIED") return "当前账号不能访问这项内容。";
  if (reason === "ASSIGNMENT_STATE_CHANGED") return "作业状态已变化，请刷新后再继续。";
  return "操作没有完成，请稍后再试。";
}
