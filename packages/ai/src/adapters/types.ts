export interface AdapterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AdapterRequest {
  model: string;
  messages: AdapterMessage[];
  responseFormat?: "json_object" | "text";
  temperature?: number;
  // multimodal (qwen-vl): data URLs appended to the last user message.
  imageDataUrls?: string[];
  /**
   * 思考型模型开关（qwen3.x / deepseek-v4 等）：
   * - `false`：关闭 reasoning，延迟/成本显著下降，且实测正文更完整；
   * - `true` ：显式开启；
   * - `undefined`：不传该参数（兼容非思考模型与第三方 provider）。
   */
  enableThinking?: boolean;
  /** 单次请求超时（毫秒），由 task 配置给出；缺省用适配器默认值。 */
  timeoutMs?: number;
}

export interface AdapterResponse {
  content: string;             // 模型输出（JSON 字符串或纯文本）
  tokensIn?: number;
  tokensOut?: number;
  model: string;               // 实际使用的模型名
}

export interface ModelAdapter {
  name: string;
  call(req: AdapterRequest): Promise<AdapterResponse>;
}
