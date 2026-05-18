"use server";

import { getAiRouter, DEV_USER_ID } from "@/lib/ai-client";
import { TutoringInputSchema, type TutoringOutput } from "@zhijiao/ai";

export type TutorActionResult =
  | { ok: true; data: TutoringOutput }
  | { ok: false; error: string };

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
    return { ok: false, error: e instanceof Error ? e.message : "调用失败" };
  }
}
