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
    const resp = await this.client.chat.completions.create({
      model: req.model,
      messages: req.messages,
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
