import OpenAI from "openai";
import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

export class DashScopeAdapter implements ModelAdapter {
  name = "dashscope";
  private client: OpenAI;

  constructor(opts: { apiKey?: string; baseURL?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required for DashScopeAdapter");
    this.client = new OpenAI({
      apiKey,
      baseURL:
        opts.baseURL ??
        process.env.DASHSCOPE_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  }

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    // Multimodal (qwen-vl): rewrite the last user message into OpenAI-compatible
    // content parts (text + image_url) when image data URLs are present.
    const messages = req.imageDataUrls?.length
      ? req.messages.map((m, i, arr) =>
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
        )
      : req.messages;
    const resp = await this.client.chat.completions.create({
      model: req.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: req.temperature ?? 0.3,
      response_format:
        req.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    });

    const choice = resp.choices[0];
    if (!choice?.message?.content) {
      throw new Error("DashScope returned no content");
    }
    return {
      content: choice.message.content,
      tokensIn: resp.usage?.prompt_tokens,
      tokensOut: resp.usage?.completion_tokens,
      model: resp.model,
    };
  }
}
