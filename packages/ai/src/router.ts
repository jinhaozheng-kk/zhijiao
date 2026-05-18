import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ModelCallStatus } from "@prisma/client";
import type { ModelAdapter } from "./adapters/types.js";
import { TASK_MODEL_MAP, type TaskKind } from "./tasks.js";
import { TutoringInputSchema, TutoringOutputSchema, type TutoringOutput } from "./schemas.js";
import { loadPrompt, ensurePromptInDb } from "./registry.js";
import { writeAudit } from "./audit.js";

export interface RouterOptions {
  prisma: PrismaClient;
  adapter: ModelAdapter;
  userId?: string | null;        // 后续真鉴权落地后由调用方传入
  modelOverride?: string;        // 测试或 A/B 时覆盖
  promptVersion?: string;        // 默认 "v1"
}

export class AiRouter {
  constructor(private opts: RouterOptions) {}

  async tutor(input: unknown): Promise<TutoringOutput> {
    const parsed = TutoringInputSchema.parse(input);
    const taskKind: TaskKind = "TUTOR_TURN";
    const prompt = await loadPrompt("tutoring", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      questionStem: parsed.questionStem,
      studentGrade: parsed.studentGrade ?? "G8",
    });

    const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
    const request = {
      model,
      messages: [
        { role: "system" as const, content: "你是严谨、面向中国 K12 的数学辅导助手。" },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.3,
    };

    const start = Date.now();
    let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
    let parseAttempts = 0;
    let lastError: unknown = null;

    // JSON 解析最多重试 2 次（spec §3.4: retry-on-JSON-parse-fail）
    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        const json = JSON.parse(response.content);
        const validated = TutoringOutputSchema.parse(json);

        await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });

        return validated;
      } catch (e) {
        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          // 解析失败：再来一次；告诉模型「上次输出不是合法 JSON」
          request.messages.push({
            role: "user",
            content: "上次输出不是符合 schema 的 JSON，请重新只输出 JSON。",
          });
          continue;
        }
        // 适配器层错误，直接走审计 + 抛
        await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.ADAPTER_ERROR,
          errorMessage: e instanceof Error ? e.message : String(e),
          userId: this.opts.userId ?? null,
        });
        throw e;
      }
    }

    // 用尽重试都解析失败
    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `TUTOR_TURN failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
