import OpenAI from "openai";
import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

const FALLBACK_TIMEOUT_MS = 600_000;

interface ChatChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

// 兼容模式把 `enable_thinking` / `stream_options` 当扩展字段：openai-node 不为其
// 提供类型，这里用窄化的调用签名做一次显式转换（不做 any 扩散）。
type CreateFn = (
  params: Record<string, unknown>,
  options?: { timeout?: number },
) => Promise<unknown>;

export class DashScopeAdapter implements ModelAdapter {
  name = "dashscope";
  private client: OpenAI;
  private streaming: boolean;
  private defaultTimeoutMs: number;

  constructor(
    opts: {
      apiKey?: string;
      baseURL?: string;
      /** 测试注入：伪造 OpenAI client，避免真实网络调用。 */
      client?: OpenAI;
      /** 覆盖流式开关；缺省读 `AI_STREAM`（false/0 关闭）。 */
      stream?: boolean;
    } = {},
  ) {
    const streamEnv = process.env.AI_STREAM?.trim().toLowerCase();
    this.streaming = opts.stream ?? !(streamEnv === "false" || streamEnv === "0");
    const timeoutEnv = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "");
    this.defaultTimeoutMs =
      Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : FALLBACK_TIMEOUT_MS;

    if (opts.client) {
      this.client = opts.client;
      return;
    }

    const apiKey = opts.apiKey ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required for DashScopeAdapter");
    this.client = new OpenAI({
      apiKey,
      baseURL:
        opts.baseURL ??
        process.env.DASHSCOPE_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      // 长结构化生成（整卷/整份课件）单次可能 >2 分钟：放宽超时，SDK 只做 1 次瞬断重试。
      timeout: this.defaultTimeoutMs,
      maxRetries: 1,
    });
  }

  private buildMessages(req: AdapterRequest) {
    // Multimodal (qwen-vl): rewrite the last user message into OpenAI-compatible
    // content parts (text + image_url) when image data URLs are present.
    if (!req.imageDataUrls?.length) return req.messages;
    return req.messages.map((m, i, arr) =>
      m.role === "user" && i === arr.length - 1
        ? {
            role: m.role,
            content: [
              { type: "text" as const, text: m.content },
              ...req.imageDataUrls!.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
            ],
          }
        : m,
    );
  }

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    const params: Record<string, unknown> = {
      model: req.model,
      messages: this.buildMessages(req),
      temperature: req.temperature ?? 0.3,
      ...(req.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {}),
      // 仅当调用方显式给出时才传：非思考模型（qwen-max 等）也接受该字段，
      // 但第三方 OpenAI 兼容服务可能不认，保持「缺省不发送」。
      ...(req.enableThinking === undefined
        ? {}
        : { enable_thinking: req.enableThinking }),
    };
    const requestOptions = { timeout: req.timeoutMs ?? this.defaultTimeoutMs };
    // 必须 bind：取出方法后直接调用会丢 `this`（openai SDK 内部依赖 this._client）。
    const create = this.client.chat.completions.create.bind(
      this.client.chat.completions,
    ) as unknown as CreateFn;

    if (!this.streaming) {
      const resp = (await create(params, requestOptions)) as ChatCompletion;
      const content = resp.choices?.[0]?.message?.content;
      if (!content) throw new Error("DashScope returned no content");
      return {
        content,
        tokensIn: resp.usage?.prompt_tokens,
        tokensOut: resp.usage?.completion_tokens,
        model: resp.model ?? req.model,
      };
    }

    // 流式：既避免长生成被首字节超时打断，也便于未来把进度透出到 UI。
    const stream = (await create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      requestOptions,
    )) as AsyncIterable<ChatChunk>;

    let content = "";
    let usage: ChatChunk["usage"] = null;
    let model = req.model;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) content += delta;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) model = chunk.model;
    }
    if (!content) throw new Error("DashScope returned no content");
    return {
      content,
      tokensIn: usage?.prompt_tokens,
      tokensOut: usage?.completion_tokens,
      model,
    };
  }
}
