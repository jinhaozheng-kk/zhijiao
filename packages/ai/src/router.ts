import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ModelCallStatus } from "@prisma/client";
import { findForbidden, redactPii } from "@zhijiao/domain";
import type { ModelAdapter } from "./adapters/types.js";
import { resolveTaskConfig, type TaskKind } from "./tasks.js";
import {
  TutoringInputSchema,
  TutoringOutputSchema,
  type TutoringOutput,
  TutoringImageInputSchema,
  TutoringImageOutputSchema,
  type TutoringImageOutput,
  ErrorAnalysisInputSchema,
  ErrorAnalysisOutputSchema,
  type ErrorAnalysisOutput,
  VariantGenerationInputSchema,
  VariantGenerationOutputSchema,
  type VariantGenerationOutput,
  AssignmentQuestionGenerationInputSchema,
  AssignmentQuestionGenerationOutputSchema,
  type AssignmentQuestionGenerationOutput,
  PaperGenerationInputSchema,
  PaperGenerationOutputSchema,
  type PaperGenerationOutput,
  FigureGenerationInputSchema,
  FigureGenerationOutputSchema,
  type FigureGenerationOutput,
  type FigureSpec,
  LessonPlanGenerationInputSchema,
  LessonPlanGenerationOutputSchema,
  type LessonPlanGenerationOutput,
  KpReconciliationInputSchema,
  KpReconciliationOutputSchema,
  type KpReconciliationOutput,
  LearningAdviceInputSchema,
  LearningAdviceOutputSchema,
  type LearningAdviceOutput,
} from "./schemas.js";
import { loadPrompt, ensurePromptInDb } from "./registry.js";
import { writeAudit } from "./audit.js";

export class ComplianceRejectedError extends Error {
  // taskKind preserved for debug/log; original sites only passed hits, so it defaults
  // to "AI" for back-compat. Plan 4 callers pass the actual task kind.
  constructor(public hits: readonly string[], taskKind: string = "AI") {
    super(`${taskKind} output rejected by compliance filter: ${hits.join(", ")}`);
    this.name = "ComplianceRejectedError";
  }
}

function scanTutoringOutputForForbidden(out: TutoringOutput): string[] {
  const corpus = [
    out.restatement,
    out.finalAnswer,
    ...out.knowledgePoints,
    ...out.steps,
    ...out.pitfalls,
  ].join("\n");
  return findForbidden(corpus);
}

function scanTutoringImageOutputForForbidden(out: TutoringImageOutput): string[] {
  const corpus = [
    out.stemTranscript,
    out.restatement,
    out.finalAnswer,
    ...out.knowledgePoints,
    ...out.steps,
    ...out.pitfalls,
  ].join("\n");
  return findForbidden(corpus);
}

function scanErrorAnalysisOutputForForbidden(out: ErrorAnalysisOutput): string[] {
  const corpus = [out.reasoning, ...out.suggestedKnowledgePoints].join("\n");
  return findForbidden(corpus);
}

function scanVariantGenerationOutputForForbidden(
  out: VariantGenerationOutput,
): string[] {
  const corpus = out.items
    .flatMap((it) => [it.stemMd, it.solutionMd, ...it.knowledgePointHints])
    .join("\n");
  return findForbidden(corpus);
}

function scanAssignmentQuestionGenerationForForbidden(
  out: AssignmentQuestionGenerationOutput,
): string[] {
  const corpus = [
    out.title,
    ...out.tiers.flatMap((tier) => [
      tier.rationaleMd,
      ...tier.items.flatMap((item) => [
        item.stemMd,
        item.answerMd,
        item.solutionMd,
        item.rubricMd ?? "",
        ...(item.options ?? []).map((option) => option.text),
        ...item.knowledgePointHints,
      ]),
    ]),
  ].join("\n");
  return findForbidden(corpus);
}

function scanPaperGenerationForForbidden(out: PaperGenerationOutput): string[] {
  const corpus = [
    out.title,
    ...out.items.flatMap((i) => [i.stemMd, i.answerMd, i.solutionMd, i.rubricMd ?? ""]),
  ].join("\n");
  return findForbidden(corpus);
}

function scanFigureGenerationForForbidden(out: FigureGenerationOutput): string[] {
  if (!out.figure) return [];
  const corpus = [
    ...out.figure.points.map((point) => point.id),
    ...out.figure.labels.map((label) => label.text),
  ].join("\n");
  return findForbidden(corpus);
}

function scanLessonPlanGenerationForForbidden(
  out: LessonPlanGenerationOutput,
): string[] {
  const corpus = [
    out.title,
    ...out.sections.flatMap((s) => [s.title, s.contentMd]),
  ].join("\n");
  return findForbidden(corpus);
}

function scanLearningAdviceForForbidden(out: LearningAdviceOutput): string[] {
  const corpus = [
    out.summaryMd,
    out.encouragementMd,
    ...out.suggestions.flatMap((s) => [s.focusKp, s.methodMd]),
  ].join("\n");
  return findForbidden(corpus);
}

export interface RouterOptions {
  prisma: PrismaClient;
  adapter: ModelAdapter;
  userId?: string | null;        // 后续真鉴权落地后由调用方传入
  modelOverride?: string;        // 测试或 A/B 时覆盖
  promptVersion?: string;        // 默认 "v1"
}

export class AiRouter {
  constructor(private opts: RouterOptions) {}

  /**
   * 解析该 task 的请求基座：默认模型 / 思考开关 / 超时，支持 env 覆盖
   * （`AI_MODEL_<KIND>` / `AI_THINKING_<KIND>` / `AI_TIMEOUT_MS_<KIND>`）。
   * `modelOverride` 仍具有最高优先级（测试与 A/B 用）。
   */
  private taskBase(taskKind: TaskKind): {
    model: string;
    enableThinking?: boolean;
    timeoutMs?: number;
  } {
    const cfg = resolveTaskConfig(taskKind);
    return {
      model: this.opts.modelOverride ?? cfg.model,
      ...(cfg.enableThinking === undefined ? {} : { enableThinking: cfg.enableThinking }),
      ...(cfg.timeoutMs === undefined ? {} : { timeoutMs: cfg.timeoutMs }),
    };
  }

  private async runJsonTaskWithAudit<T extends object>(args: {
    taskKind: TaskKind;
    promptTemplateId: string;
    request: {
      model: string;
      messages: Array<{ role: "system" | "user"; content: string }>;
      responseFormat: "json_object";
      temperature: number;
      imageDataUrls?: string[];
      enableThinking?: boolean;
      timeoutMs?: number;
    };
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    scanForbidden: (output: T) => string[];
    retryMessage?: string;
  }): Promise<T & { modelCallId: string }> {
    const start = Date.now();
    let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
    let parseAttempts = 0;
    let lastError: unknown = null;

    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(args.request);
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（一处覆盖所有 AI 任务）。
        // 占位符不含引号/括号，落在 JSON 字符串值内仍合法。
        response.content = redactPii(response.content).redacted;
        const json = JSON.parse(response.content);
        const validated = args.schema.parse(json);

        const hits = args.scanForbidden(validated);
        if (hits.length > 0) {
          const modelCallId = await writeAudit(this.opts.prisma, {
            taskKind: args.taskKind,
            promptTemplateId: args.promptTemplateId,
            request: args.request,
            response,
            latencyMs: Date.now() - start,
            status: ModelCallStatus.COMPLIANCE_REJECTED,
            errorMessage: `forbidden phrases: ${hits.join(", ")}`,
            userId: this.opts.userId ?? null,
          });
          const error = new ComplianceRejectedError(hits, args.taskKind);
          (error as ComplianceRejectedError & { modelCallId?: string }).modelCallId =
            modelCallId;
          throw error;
        }

        const modelCallId = await writeAudit(this.opts.prisma, {
          taskKind: args.taskKind,
          promptTemplateId: args.promptTemplateId,
          request: args.request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });
        return { ...validated, modelCallId };
      } catch (e) {
        if (e instanceof ComplianceRejectedError) throw e;

        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          args.request.messages.push({
            role: "user",
            content:
              args.retryMessage ??
              "The previous output was not valid JSON for the schema. Return JSON only.",
          });
          continue;
        }

        await writeAudit(this.opts.prisma, {
          taskKind: args.taskKind,
          promptTemplateId: args.promptTemplateId,
          request: args.request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.ADAPTER_ERROR,
          errorMessage: e instanceof Error ? e.message : String(e),
          userId: this.opts.userId ?? null,
        });
        throw e;
      }
    }

    await writeAudit(this.opts.prisma, {
      taskKind: args.taskKind,
      promptTemplateId: args.promptTemplateId,
      request: args.request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `${args.taskKind} failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async tutor(input: unknown): Promise<TutoringOutput> {
    const parsed = TutoringInputSchema.parse(input);
    const taskKind: TaskKind = "TUTOR_TURN";
    const prompt = await loadPrompt("tutoring", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      questionStem: parsed.questionStem,
      studentGrade: parsed.studentGrade ?? "G8",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
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
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（与 runJsonTaskWithAudit 一致）。
        response.content = redactPii(response.content).redacted;
        const json = JSON.parse(response.content);
        const validated = TutoringOutputSchema.parse(json);

        // 合规 post-filter（spec §3.5）：扫描整段输出，命中黑词则审计 + 抛
        const hits = scanTutoringOutputForForbidden(validated);
        if (hits.length > 0) {
          await writeAudit(this.opts.prisma, {
            taskKind,
            promptTemplateId,
            request,
            response,
            latencyMs: Date.now() - start,
            status: ModelCallStatus.COMPLIANCE_REJECTED,
            errorMessage: `forbidden phrases: ${hits.join(", ")}`,
            userId: this.opts.userId ?? null,
          });
          throw new ComplianceRejectedError(hits);
        }

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
        // 合规拒绝已在 try 中审计；直接抛，不要走 retry / 二次审计
        if (e instanceof ComplianceRejectedError) throw e;

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

  // 图片/OCR 拍照答疑：单次多模态调用，qwen-vl 同时转写题面（stemTranscript）
  // 与产出 hint-first 讲解。复用 runJsonTaskWithAudit（脱敏/合规/审计/重试一致），
  // 仅多带 imageDataUrls。
  async tutorImage(
    input: unknown,
  ): Promise<TutoringImageOutput & { modelCallId: string }> {
    const parsed = TutoringImageInputSchema.parse(input);
    const taskKind: TaskKind = "TUTOR_ASK_IMAGE";
    const prompt = await loadPrompt("tutoring-image", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);
    const userContent = prompt.interpolate({
      studentGrade: parsed.studentGrade ?? "G8",
    });
    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content: "你是严谨、面向中国 K12 的数学拍照辅导助手。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.3,
      imageDataUrls: [parsed.imageDataUrl],
    };
    return this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: TutoringImageOutputSchema,
      scanForbidden: scanTutoringImageOutputForForbidden,
    });
  }

  // Plan 4: error.diagnose backing call.
  // Returns the validated ErrorAnalysisOutput plus the audit ModelCall.id so
  // the caller can persist `lastDiagnoseCallId` on the ErrorBookEntry row.
  async diagnoseError(
    input: unknown,
  ): Promise<ErrorAnalysisOutput & { modelCallId: string }> {
    const parsed = ErrorAnalysisInputSchema.parse(input);
    const taskKind: TaskKind = "ERROR_ANALYSIS";
    const prompt = await loadPrompt(
      "error-analysis",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      stemMd: parsed.stemMd,
      correctAnswerMd: parsed.correctAnswerMd ?? "（未提供）",
      actualAnswerMd: parsed.actualAnswerMd ?? "（未提供）",
      studentGrade: parsed.studentGrade ?? "G8",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content: "你是严谨、面向中国 K12 的错因分析助手。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.2,
    };

    const start = Date.now();
    let response = null as Awaited<
      ReturnType<typeof this.opts.adapter.call>
    > | null;
    let parseAttempts = 0;
    let lastError: unknown = null;

    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（与 runJsonTaskWithAudit 一致）。
        response.content = redactPii(response.content).redacted;
        const json = JSON.parse(response.content);
        const validated = ErrorAnalysisOutputSchema.parse(json);

        const hits = scanErrorAnalysisOutputForForbidden(validated);
        if (hits.length > 0) {
          await writeAudit(this.opts.prisma, {
            taskKind,
            promptTemplateId,
            request,
            response,
            latencyMs: Date.now() - start,
            status: ModelCallStatus.COMPLIANCE_REJECTED,
            errorMessage: `forbidden phrases: ${hits.join(", ")}`,
            userId: this.opts.userId ?? null,
          });
          throw new ComplianceRejectedError(hits, taskKind);
        }

        const modelCallId = await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });
        return { ...validated, modelCallId };
      } catch (e) {
        if (e instanceof ComplianceRejectedError) throw e;

        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          request.messages.push({
            role: "user",
            content: "上次输出不是符合 schema 的 JSON，请重新只输出 JSON。",
          });
          continue;
        }
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

    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage:
        lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `ERROR_ANALYSIS failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  // Plan 4: variant.generateForEntry backing call.
  // Returns the validated VariantGenerationOutput plus the audit ModelCall.id
  // so the caller can persist `modelCallId` on the VariantGroup row.
  async generateVariants(
    input: unknown,
  ): Promise<VariantGenerationOutput & { modelCallId: string }> {
    const parsed = VariantGenerationInputSchema.parse(input);
    const taskKind: TaskKind = "VARIANT_GROUP_GEN";
    const prompt = await loadPrompt(
      "variant-generation",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    // anchorKps 序列化为可注入 prompt 的 Markdown 列表
    const anchorKpsRendered = parsed.anchorKps
      .map((k) => `- ${k.name}（difficulty=${k.difficulty}）`)
      .join("\n");

    const userContent = prompt.interpolate({
      anchorStemMd: parsed.anchorStemMd,
      anchorRootCause: parsed.anchorRootCause,
      anchorKps: anchorKpsRendered,
      studentGrade: parsed.studentGrade ?? "G8",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content:
            "你是严谨、面向中国 K12 的举一反三变式生成助手。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.5, // 变式需要一定多样性
    };

    const start = Date.now();
    let response = null as Awaited<
      ReturnType<typeof this.opts.adapter.call>
    > | null;
    let parseAttempts = 0;
    let lastError: unknown = null;

    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（与 runJsonTaskWithAudit 一致）。
        response.content = redactPii(response.content).redacted;
        const json = JSON.parse(response.content);
        const validated = VariantGenerationOutputSchema.parse(json);

        const hits = scanVariantGenerationOutputForForbidden(validated);
        if (hits.length > 0) {
          await writeAudit(this.opts.prisma, {
            taskKind,
            promptTemplateId,
            request,
            response,
            latencyMs: Date.now() - start,
            status: ModelCallStatus.COMPLIANCE_REJECTED,
            errorMessage: `forbidden phrases: ${hits.join(", ")}`,
            userId: this.opts.userId ?? null,
          });
          throw new ComplianceRejectedError(hits, taskKind);
        }

        const modelCallId = await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });
        return { ...validated, modelCallId };
      } catch (e) {
        if (e instanceof ComplianceRejectedError) throw e;

        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          request.messages.push({
            role: "user",
            content:
              "上次输出不是符合 schema 的 JSON（必须 3 道，level L1/L2/L3 各一），请重新只输出 JSON。",
          });
          continue;
        }
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

    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage:
        lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `VARIANT_GROUP_GEN failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  // Plan 9: kp:reconcile-pending CLI 调这个；不计 Credit。
  // 输出按 matchId 对齐写回：LLM 漏返/重复 → retry 2 次再 PARSE_FAILED；
  // 多返不在本批 matchId → 静默忽略（不算异常，spec §4.2）。
  async generateAssignmentQuestions(
    input: unknown,
  ): Promise<AssignmentQuestionGenerationOutput & { modelCallId: string }> {
    const parsed = AssignmentQuestionGenerationInputSchema.parse(input);
    const taskKind: TaskKind = "ASSIGNMENT_QUESTION_GEN";
    const prompt = await loadPrompt(
      "assignment-question-gen",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      subject: parsed.subject,
      gradeLevel: parsed.gradeLevel,
      kpNames: parsed.kpNames.join(", "),
      questionTypes: parsed.questionTypes.join(", "),
      tierCounts: JSON.stringify(parsed.tierCounts),
      difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
      teachingGoalMd: parsed.teachingGoalMd ?? "(not provided)",
      classWeaknessSummaryMd: parsed.classWeaknessSummaryMd ?? "(not provided)",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content:
            "You are a rigorous K12 math assignment question generation assistant.",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.35,
    };

    return this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: AssignmentQuestionGenerationOutputSchema,
      scanForbidden: scanAssignmentQuestionGenerationForForbidden,
    });
  }

  // Plan 17: paper generation backing call.
  // Returns the validated PaperGenerationOutput plus the audit ModelCall.id.
  async generatePaper(
    input: unknown,
  ): Promise<PaperGenerationOutput & { modelCallId: string }> {
    const parsed = PaperGenerationInputSchema.parse(input);
    const taskKind: TaskKind = "PAPER_GEN";
    const prompt = await loadPrompt("paper-gen", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const sectionsHuman = parsed.sections
      .map((s) => `${s.type}×${s.count}`)
      .join("，");
    const baseUserContent = prompt.interpolate({
      subject: parsed.subject,
      gradeLevel: parsed.gradeLevel,
      kpNames: parsed.kpNames.join(", "),
      textbookVersion: parsed.textbookVersion ?? "通用",
      sections: sectionsHuman,
      sectionsJson: JSON.stringify(parsed.sections),
      difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
      excludeStems: parsed.excludeStems.length ? parsed.excludeStems.join(" / ") : "(无)",
      styleRules: parsed.styleRules?.length ? parsed.styleRules.join("；") : "(无)",
      slotHints: parsed.slotHints?.length
        ? parsed.slotHints.map((h) => `${h.type}: ${h.intent}（${h.constraints.join("、")}）`).join(" / ")
        : "(无)",
    });
    const userContent = [
      baseUserContent,
      `KP_NAMES_JSON:${JSON.stringify(parsed.kpNames)}`,
      "Every generated item must be based on one of KP_NAMES_JSON. Do not generate items for unrelated knowledge points.",
      "Each item's knowledgePointHints must include the selected knowledge point it assesses.",
      ...(parsed.qualityInstructions?.length
        ? [
            "REPAIR_INSTRUCTIONS（上一轮审题未通过，本次必须逐条修正后再输出）：",
            ...parsed.qualityInstructions.map((instruction) => `- ${instruction}`),
          ]
        : []),
    ].join("\n\n");

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        { role: "system" as const, content: "你是严谨的 K12 数学练习卷命题助手。" },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.35,
    };

    return this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: PaperGenerationOutputSchema,
      scanForbidden: scanPaperGenerationForForbidden,
      // qwen-max 偶发把 JSON 写坏（多余冒号/引号、字符串内裸换行）。
      // 重试时给可执行的修法，比默认的「请重新只输出 JSON」更有效。
      retryMessage:
        "上次输出不是合法 JSON。请只输出严格合法的 JSON：字符串内禁止出现未转义的换行符或双引号，禁止注释、禁止多余文本；选择题 options 必须是 4 个字符串组成的 JSON 数组；除 JSON 外不要输出任何内容。",
    });
  }

  // 浙江卷配图：题干 → 受约束的图形 DSL。
  // 独立于主出卷调用（不让配图 JSON 影响整卷解析成功率）；返回 null 表示本题不需要配图。
  async generateFigure(
    input: unknown,
  ): Promise<{ figure: FigureSpec | null; modelCallId: string }> {
    const parsed = FigureGenerationInputSchema.parse(input);
    const taskKind: TaskKind = "PAPER_FIGURE_GEN";
    const prompt = await loadPrompt(
      "paper-figure",
      // v2：增加函数图象 curves 契约（v1 已注册进 DB，按仓库规范只能升版不能原地改）
      this.opts.promptVersion ?? "v2",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);
    const userContent = prompt.interpolate({
      stemMd: parsed.stemMd,
      gradeLevel: parsed.gradeLevel ?? "G9",
      questionType: parsed.questionType ?? "（未提供）",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content: "你是严谨的 K12 数学几何配图助手，只输出图形 JSON。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.2,
    };

    const out = await this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: FigureGenerationOutputSchema,
      scanForbidden: scanFigureGenerationForForbidden,
      retryMessage:
        "上次输出不是合法 JSON。请只输出严格合法的 JSON 对象：{\"figure\": null} 或 {\"figure\": {\"kind\": \"GEOMETRY\"|\"COORDINATE\", ...}}；字符串内禁止未转义换行或双引号，禁止注释与多余文本。",
    });
    return { figure: out.figure, modelCallId: out.modelCallId };
  }

  // Plan 18: 教师 AI 课件生成。返回校验过的五段课件 + 审计 ModelCall.id。
  async generateLessonPlan(
    input: unknown,
  ): Promise<LessonPlanGenerationOutput & { modelCallId: string }> {
    const parsed = LessonPlanGenerationInputSchema.parse(input);
    const taskKind: TaskKind = "LESSON_PLAN_GEN";
    const prompt = await loadPrompt("lesson-plan-gen", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      gradeLevel: parsed.gradeLevel,
      kpNames: parsed.kpNames.join(", "),
      teachingGoal: parsed.teachingGoal ?? "(未提供)",
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        { role: "system" as const, content: "你是严谨的 K12 数学课件生成助手。" },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.4,
    };

    return this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: LessonPlanGenerationOutputSchema,
      scanForbidden: scanLessonPlanGenerationForForbidden,
    });
  }

  // Plan 11: analytics.profile.generateAdvice backing call.
  // KP mastery → 可迁移学习方法建议；合规扫描走 AI 输出（白名单不补偿在 router 层处理）。
  async generateLearningAdvice(
    input: unknown,
  ): Promise<LearningAdviceOutput & { modelCallId: string }> {
    const parsed = LearningAdviceInputSchema.parse(input);
    const taskKind: TaskKind = "LEARNING_ADVICE";
    const prompt = await loadPrompt(
      "learning-advice",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const focusRendered =
      parsed.focusAreas
        .map(
          (f) =>
            `- ${f.kpName}（参考掌握度=${f.score === null ? "数据不足" : f.score}）`,
        )
        .join("\n") || "（暂无）";
    const strengthsRendered =
      parsed.strengths.map((s) => `- ${s}`).join("\n") || "（暂无）";

    const userContent = prompt.interpolate({
      studentGrade: parsed.studentGrade ?? "G8",
      focusAreas: focusRendered,
      strengths: strengthsRendered,
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content: "你是面向中国 K12、强调方法论的学习顾问。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.4,
    };

    return this.runJsonTaskWithAudit({
      taskKind,
      promptTemplateId,
      request,
      schema: LearningAdviceOutputSchema,
      scanForbidden: scanLearningAdviceForForbidden,
    });
  }

  async kpReconcile(
    input: unknown,
  ): Promise<{
    items: KpReconciliationOutput;
    modelCallId: string;
  }> {
    const parsed = KpReconciliationInputSchema.parse(input);
    const inputDigest = createHash("sha256")
      .update(JSON.stringify(parsed))
      .digest("hex")
      .slice(0, 32);
    const taskKind: TaskKind = "KP_RECONCILE";
    const prompt = await loadPrompt(
      "kp-reconciliation",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const candidatesRendered = parsed.candidates
      .map(
        (c) =>
          `- id=${c.id}, code=${c.code}, name=${c.name}, path=${c.parentPath}` +
          (c.description ? `, desc=${c.description}` : ""),
      )
      .join("\n");
    const hintsRendered = parsed.hints
      .map((h) => `- matchId=${h.matchId}, hint=${JSON.stringify(h.normalizedHint)}`)
      .join("\n");

    const userContent = prompt.interpolate({
      candidates: candidatesRendered,
      hints: hintsRendered,
    });

    const base = this.taskBase(taskKind);
    const request = {
      ...base,
      messages: [
        {
          role: "system" as const,
          content: "你是严谨、面向中国 K12 知识点结构化的匹配助手。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.0,         // 匹配任务要确定性
    };

    const auditRequest = {
      ...request,
      inputDigest,
      subjectId: parsed.subjectId,
      candidates: parsed.candidates,
      hints: parsed.hints,
    };

    const start = Date.now();
    let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
    let parseAttempts = 0;
    let lastError: unknown = null;
    const inputMatchIds = new Set(parsed.hints.map((h) => h.matchId));

    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        // Plan 14c：AI 原始响应在 parse + 持久化前脱敏（与 runJsonTaskWithAudit 一致）。
        response.content = redactPii(response.content).redacted;
        const json = JSON.parse(response.content);
        const validated = KpReconciliationOutputSchema.parse(json);

        // 多返不属于本批 matchId → 静默忽略（spec §4.2 末段）
        const filtered = validated.filter((it) => inputMatchIds.has(it.matchId));

        // 漏返 / 重复 → 视为输出无效，触发 retry
        const returnedIds = new Set(filtered.map((it) => it.matchId));
        const hasAllMatchIds = parsed.hints.every((h) => returnedIds.has(h.matchId));
        const hasNoDuplicates = filtered.length === returnedIds.size;
        // Plan 9 Task 3 hotfix (review P1): kpId 必须属于本批候选集。LLM 可能 hallucinate
        // 一个合法 cuid 但不是本 subject 的 KP；schema 只验 cuid 形状不验归属，
        // 一旦放过会被 Task 8 直接写到 KpReconcileMatch/QuestionKPLink 上，绕过 subject scoping。
        const candidateKpIds = new Set(parsed.candidates.map((c) => c.id));
        const allKpIdsValid = filtered.every(
          (it) => it.kpId === null || candidateKpIds.has(it.kpId),
        );
        if (!hasAllMatchIds || !hasNoDuplicates || !allKpIdsValid) {
          const reason = !allKpIdsValid
            ? "kpId 不在候选集"
            : !hasNoDuplicates
              ? "matchId 重复"
              : "matchId 漏返";
          lastError = new Error(
            `LLM output validation failed (${reason}): returned=${filtered.length}, expected=${parsed.hints.length}`,
          );
          parseAttempts++;
          request.messages.push({
            role: "user",
            content: !allKpIdsValid
              ? "上次输出包含不在候选集中的 kpId。每个 kpId 必须严格来自本批 candidates 列表的 id，或 null。请重新只输出 JSON。"
              : "上次输出 matchId 未与输入一一对应。请严格输出与输入 hints 数量相同的项，每个 matchId 出现且仅出现一次。",
          });
          continue;
        }

        const modelCallId = await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request: auditRequest,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });
        return { items: filtered, modelCallId };
      } catch (e) {
        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          request.messages.push({
            role: "user",
            content: "上次输出不是符合 schema 的 JSON 数组，请重新只输出 JSON。",
          });
          continue;
        }
        await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request: auditRequest,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.ADAPTER_ERROR,
          errorMessage: e instanceof Error ? e.message : String(e),
          userId: this.opts.userId ?? null,
        });
        throw e;
      }
    }

    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request: auditRequest,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage:
        lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `KP_RECONCILE failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
