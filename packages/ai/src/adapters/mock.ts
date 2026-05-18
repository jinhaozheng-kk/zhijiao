import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

export class MockAdapter implements ModelAdapter {
  name = "mock";

  constructor(
    private opts: {
      // 测试可注入指定响应；否则返回符合 TutoringOutput 的占位 JSON
      respondWith?: (req: AdapterRequest) => Promise<AdapterResponse> | AdapterResponse;
    } = {},
  ) {}

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    if (this.opts.respondWith) return this.opts.respondWith(req);
    const fakeTutoring = {
      restatement: "求解一元一次方程。",
      knowledgePoints: ["一次方程求解"],
      steps: ["把常数移到等号一边", "两边同除以未知数系数"],
      pitfalls: ["注意符号"],
      finalAnswer: "x = 4",
    };
    return {
      content: JSON.stringify(fakeTutoring),
      tokensIn: 100,
      tokensOut: 80,
      model: "mock-v1",
    };
  }
}
