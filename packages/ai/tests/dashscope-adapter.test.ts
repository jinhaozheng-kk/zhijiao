import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { DashScopeAdapter } from "../src/index.js";

type Seen = { params?: Record<string, unknown>; options?: { timeout?: number } };

function fakeClient(opts: {
  stream?: boolean;
  chunks?: Array<Record<string, unknown>>;
  completion?: Record<string, unknown>;
  seen?: Seen;
}): OpenAI {
  const create = async (params: Record<string, unknown>, options?: { timeout?: number }) => {
    if (opts.seen) {
      opts.seen.params = params;
      opts.seen.options = options;
    }
    if (opts.stream) {
      const chunks = opts.chunks ?? [];
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    }
    return opts.completion;
  };
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("DashScopeAdapter", () => {
  it("流式调用：聚合 delta、透传 usage，并发送 enable_thinking/stream_options", async () => {
    const seen: Seen = {};
    const adapter = new DashScopeAdapter({
      stream: true,
      client: fakeClient({
        stream: true,
        seen,
        chunks: [
          { model: "qwen3.8-max", choices: [{ delta: { content: '{"items":' } }] },
          { model: "qwen3.8-max", choices: [{ delta: { content: "[1]}" } }] },
          {
            model: "qwen3.8-max",
            choices: [{ delta: { content: "" } }],
            usage: { prompt_tokens: 111, completion_tokens: 222 },
          },
        ],
      }),
    });

    const out = await adapter.call({
      model: "qwen3.8-max",
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json_object",
      temperature: 0.35,
      enableThinking: false,
    });

    expect(out.content).toBe('{"items":[1]}');
    expect(out.tokensIn).toBe(111);
    expect(out.tokensOut).toBe(222);
    expect(out.model).toBe("qwen3.8-max");
    expect(seen.params?.stream).toBe(true);
    expect(seen.params?.stream_options).toEqual({ include_usage: true });
    expect(seen.params?.enable_thinking).toBe(false);
    expect(seen.params?.response_format).toEqual({ type: "json_object" });
  });

  it("非流式调用：不发送 stream 字段，正常返回 content/usage", async () => {
    const seen: Seen = {};
    const adapter = new DashScopeAdapter({
      stream: false,
      client: fakeClient({
        seen,
        completion: {
          model: "qwen-max",
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      }),
    });

    const out = await adapter.call({
      model: "qwen-max",
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json_object",
    });

    expect(out.content).toBe('{"ok":true}');
    expect(out.tokensOut).toBe(5);
    expect(seen.params?.stream).toBeUndefined();
    expect(seen.params?.enable_thinking).toBeUndefined();
  });

  it("enableThinking 缺省时不发送该字段（兼容非思考/第三方模型）", async () => {
    const seen: Seen = {};
    const adapter = new DashScopeAdapter({
      stream: true,
      client: fakeClient({
        stream: true,
        seen,
        chunks: [{ choices: [{ delta: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }],
      }),
    });
    await adapter.call({ model: "qwen-max", messages: [{ role: "user", content: "hi" }] });
    expect("enable_thinking" in (seen.params ?? {})).toBe(false);
  });

  it("timeoutMs 透传到 SDK 请求选项", async () => {
    const seen: Seen = {};
    const adapter = new DashScopeAdapter({
      stream: false,
      client: fakeClient({
        seen,
        completion: { model: "m", choices: [{ message: { content: "ok" } }] },
      }),
    });
    await adapter.call({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 123_456,
    });
    expect(seen.options?.timeout).toBe(123_456);
  });

  it("空输出抛错（上行 router 记为 ADAPTER_ERROR）", async () => {
    const adapter = new DashScopeAdapter({
      stream: true,
      client: fakeClient({ stream: true, chunks: [{ choices: [{ delta: { content: "" } }] }] }),
    });
    await expect(
      adapter.call({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/no content/);
  });

  it("多模态请求把图片拼到最后一个 user message", async () => {
    const seen: Seen = {};
    const adapter = new DashScopeAdapter({
      stream: false,
      client: fakeClient({
        seen,
        completion: { model: "qwen3-vl-plus", choices: [{ message: { content: "{}" } }] },
      }),
    });
    await adapter.call({
      model: "qwen3-vl-plus",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "看图" },
      ],
      imageDataUrls: ["data:image/png;base64,AAAA"],
    });
    const messages = seen.params?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]?.content).toBe("sys");
    expect(Array.isArray(messages[1]?.content)).toBe(true);
    const parts = messages[1]?.content as Array<{ type: string }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
  });
});
