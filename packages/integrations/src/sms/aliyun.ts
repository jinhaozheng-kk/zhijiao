import { createHmac } from "crypto";
import { NotConfiguredError, type SmsAdapter } from "./types.js";

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

/**
 * RFC 3986 percent-encode as required by Aliyun RPC v1 signature algorithm:
 *   encodeURIComponent, then replace + → %20, * → %2A, %7E → ~
 */
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/gi, "~");
}

/**
 * Build the Aliyun RPC v1 signature for a GET request.
 *
 * Steps (per Aliyun docs):
 *  1. Sort all params by key (ASCII lexicographic).
 *  2. Canonicalize: percentEncode(key)=percentEncode(value) joined by &.
 *  3. StringToSign = "GET" + "&" + percentEncode("/") + "&" + percentEncode(canonical).
 *  4. HMAC-SHA1 with key = accessKeySecret + "&", base64-encode result.
 */
function buildSignature(params: Record<string, string>, accessKeySecret: string): string {
  const sorted = Object.keys(params).sort();
  const canonical = sorted
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join("&");
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
  const signingKey = `${accessKeySecret}&`;
  return createHmac("sha1", signingKey).update(stringToSign).digest("base64");
}

interface AliyunSmsResponse {
  Code: string;
  Message: string;
  RequestId?: string;
  BizId?: string;
}

export class AliyunSmsAdapter implements SmsAdapter {
  constructor(private cfg: AliyunSmsConfig) {
    for (const k of ["accessKeyId","accessKeySecret","signName","templateCode"] as const) {
      if (!cfg[k]) throw new NotConfiguredError(`AliyunSmsAdapter.${k}`);
    }
  }

  async send(phone: string, code: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const nonce = crypto.randomUUID();

    const params: Record<string, string> = {
      // Public params
      Action: "SendSms",
      Version: "2017-05-25",
      Format: "JSON",
      AccessKeyId: this.cfg.accessKeyId,
      SignatureMethod: "HMAC-SHA1",
      SignatureVersion: "1.0",
      SignatureNonce: nonce,
      Timestamp: timestamp,
      // Business params
      PhoneNumbers: phone,
      SignName: this.cfg.signName,
      TemplateCode: this.cfg.templateCode,
      // Template variable must be named "code" in the approved Aliyun SMS template.
      TemplateParam: JSON.stringify({ code }),
    };

    const signature = buildSignature(params, this.cfg.accessKeySecret);
    params["Signature"] = signature;

    // Build final URL with all params percent-encoded
    const queryString = Object.keys(params)
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
      .join("&");
    const url = `https://dysmsapi.aliyuncs.com/?${queryString}`;

    const res = await fetch(url);
    const body = (await res.json()) as AliyunSmsResponse;

    if (body.Code !== "OK") {
      throw new Error(
        `AliyunSmsAdapter.send failed: Code=${body.Code} Message=${body.Message}`
      );
    }
  }
}
