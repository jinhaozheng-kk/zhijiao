"use server";

import { getAiRouter, DEV_USER_ID } from "@/lib/ai-client";
import {
  ComplianceRejectedError,
  TutoringInputSchema,
  type TutoringOutput,
} from "@zhijiao/ai";

export type TutorActionResult =
  | { ok: true; data: TutoringOutput }
  | { ok: false; error: string };

// 面向终端用户的安全文案。内部细节（命中的合规黑词、堆栈、模型报错）只进 ModelCall 审计表，
// 绝不通过 server action 回显到前端——否则被拦截的违规词等于又显示了一遍。
const USER_FACING_COMPLIANCE_MSG = "讲解内容未通过合规检查，请换一道题或稍后再试。";
const USER_FACING_GENERIC_MSG = "讲解失败，请稍后再试。";

export async function askTutor(formData: FormData): Promise<TutorActionResult> {
  const raw = {
    questionStem: String(formData.get("questionStem") ?? ""),
    studentGrade: (formData.get("studentGrade") || undefined) as
      | "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11" | "G12" | undefined,
  };

  const parsed = TutoringInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }

  try {
    const router = getAiRouter(DEV_USER_ID);
    const data = await router.tutor(parsed.data);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ComplianceRejectedError) {
      // 内部详情已经在 router 里写到 ModelCall.errorMessage；这里只给用户安全文案
      return { ok: false, error: USER_FACING_COMPLIANCE_MSG };
    }
    // 其它内部错误也不要把 e.message 透出——审计表已经记了细节，前端只看到通用提示
    console.error("[askTutor] internal error:", e);
    return { ok: false, error: USER_FACING_GENERIC_MSG };
  }
}
