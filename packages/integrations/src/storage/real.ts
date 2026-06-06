import { createHmac } from "node:crypto";
import { NotConfiguredError } from "../sms/types.js";
import type { StorageAdapter } from "./types.js";

export interface OssOpts {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint: string;
}

/**
 * Build the virtual-hosted-style base URL from the endpoint option.
 * opts.endpoint may look like "https://oss-cn-beijing.aliyuncs.com"
 * or just "oss-cn-beijing.aliyuncs.com".
 * Result: "https://{bucket}.oss-cn-beijing.aliyuncs.com"
 */
function buildBaseUrl(opts: OssOpts): string {
  const host = opts.endpoint.replace(/^https?:\/\//, "");
  return `https://${opts.bucket}.${host}`;
}

/**
 * Encode an OSS object key for use in a URL path.
 * Slashes (path separators) are preserved; every other segment is
 * percent-encoded via encodeURIComponent.
 */
function encodeOssKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Build an RFC 7231 / HTTP-date string (GMT) for the current moment.
 * Example: "Tue, 06 Jun 2026 12:34:56 GMT"
 */
function httpDate(): string {
  return new Date().toUTCString();
}

/**
 * Compute the OSS V1 header-based signature.
 *
 * StringToSign = VERB + "\n"
 *              + Content-MD5 + "\n"       (empty for us)
 *              + Content-Type + "\n"      (empty for GET)
 *              + Date + "\n"
 *              + CanonicalizedOSSHeaders  (empty — no x-oss-* headers)
 *              + CanonicalizedResource    ("/" + bucket + "/" + key)
 *
 * signature = base64( HMAC-SHA1(accessKeySecret, StringToSign) )
 */
function sign(
  opts: OssOpts,
  {
    verb,
    contentType,
    date,
    key,
  }: { verb: string; contentType: string; date: string; key: string },
): string {
  const canonicalizedResource = `/${opts.bucket}/${key}`;
  const stringToSign = [
    verb,
    "",          // Content-MD5 (omitted)
    contentType, // empty string for GET
    date,
    canonicalizedResource, // no x-oss-* headers, so no CanonicalizedOSSHeaders prefix
  ].join("\n");

  return createHmac("sha1", opts.accessKeySecret)
    .update(stringToSign)
    .digest("base64");
}

// Real Aliyun OSS adapter.
// Activated by setting STORAGE_USE_MOCK=false (and providing OSS credentials).
// Uses OSS V1 header-based signature (HMAC-SHA1) and virtual-hosted-style URLs.
export class AliyunOssAdapter implements StorageAdapter {
  private readonly baseUrl: string;

  constructor(private opts: OssOpts) {
    for (const k of [
      "accessKeyId",
      "accessKeySecret",
      "bucket",
      "region",
      "endpoint",
    ] as const) {
      if (!opts[k]) {
        throw new NotConfiguredError(`AliyunOssAdapter.${k}`);
      }
    }
    this.baseUrl = buildBaseUrl(opts);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const date = httpDate();
    const signature = sign(this.opts, { verb: "PUT", contentType, date, key });
    const url = `${this.baseUrl}/${encodeOssKey(key)}`;

    // Pass an ArrayBuffer (unambiguous BodyInit under both @types/node and DOM
    // libs — a bare Uint8Array<ArrayBufferLike> is not assignable to DOM's
    // BufferSource since TS 5.7 made typed arrays generic).
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        Date: date,
        Authorization: `OSS ${this.opts.accessKeyId}:${signature}`,
      },
      body,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `AliyunOssAdapter.put failed: HTTP ${res.status} — ${body}`,
      );
    }
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const date = httpDate();
    const signature = sign(this.opts, {
      verb: "GET",
      contentType: "",
      date,
      key,
    });
    const url = `${this.baseUrl}/${encodeOssKey(key)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Date: date,
        Authorization: `OSS ${this.opts.accessKeyId}:${signature}`,
      },
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `AliyunOssAdapter.getBytes failed: HTTP ${res.status} — ${body}`,
      );
    }

    return new Uint8Array(await res.arrayBuffer());
  }
}
