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
