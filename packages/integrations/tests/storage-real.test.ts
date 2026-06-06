/**
 * Offline tests for AliyunOssAdapter (real.ts).
 * All network calls are stubbed via vi.stubGlobal('fetch', ...).
 * No real OSS credentials or network required.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as nodeCrypto from "node:crypto";
import { AliyunOssAdapter } from "../src/storage/real.js";

const OPTS = {
  accessKeyId: "testAKID",
  accessKeySecret: "testSecret",
  bucket: "my-bucket",
  region: "oss-cn-beijing",
  endpoint: "https://oss-cn-beijing.aliyuncs.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: compute the expected OSS V1 HMAC-SHA1 signature for a PUT
// ---------------------------------------------------------------------------
function computeExpectedSig(
  opts: typeof OPTS,
  {
    verb,
    contentType,
    date,
    key,
  }: { verb: string; contentType: string; date: string; key: string },
): string {
  const contentMd5 = "";
  const canonicalizedOssHeaders = "";
  const canonicalizedResource = `/${opts.bucket}/${key}`;
  const verbContentType = verb === "GET" ? "" : contentType;
  const stringToSign = [
    verb,
    contentMd5,
    verbContentType,
    date,
    canonicalizedOssHeaders + canonicalizedResource,
  ].join("\n");
  return nodeCrypto
    .createHmac("sha1", opts.accessKeySecret)
    .update(stringToSign)
    .digest("base64");
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------
describe("AliyunOssAdapter constructor", () => {
  it("throws when accessKeyId is empty", () => {
    expect(
      () => new AliyunOssAdapter({ ...OPTS, accessKeyId: "" }),
    ).toThrow();
  });

  it("throws when accessKeySecret is empty", () => {
    expect(
      () => new AliyunOssAdapter({ ...OPTS, accessKeySecret: "" }),
    ).toThrow();
  });

  it("throws when bucket is empty", () => {
    expect(
      () => new AliyunOssAdapter({ ...OPTS, bucket: "" }),
    ).toThrow();
  });

  it("throws when region is empty", () => {
    expect(
      () => new AliyunOssAdapter({ ...OPTS, region: "" }),
    ).toThrow();
  });

  it("throws when endpoint is empty", () => {
    expect(
      () => new AliyunOssAdapter({ ...OPTS, endpoint: "" }),
    ).toThrow();
  });

  it("does NOT throw when all opts are provided", () => {
    expect(() => new AliyunOssAdapter(OPTS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// put()
// ---------------------------------------------------------------------------
describe("AliyunOssAdapter.put", () => {
  it("issues a PUT to the correct virtual-hosted URL", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const bytes = new Uint8Array([10, 20, 30]);
    await adapter.put("adhoc/u1/image.png", bytes, "image/png");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://my-bucket.oss-cn-beijing.aliyuncs.com/adhoc/u1/image.png",
    );
    expect((init as RequestInit).method).toBe("PUT");
  });

  it("sends the bytes as the request body", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await adapter.put("key.bin", bytes, "application/octet-stream");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Uint8Array(init!.body as ArrayBuffer)).toEqual(bytes);
  });

  it("sets Content-Type header to the passed contentType", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await adapter.put("x.png", new Uint8Array([0]), "image/png");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    expect(headers.get("Content-Type")).toBe("image/png");
  });

  it("sets a Date header", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await adapter.put("x.png", new Uint8Array([0]), "image/png");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    expect(headers.get("Date")).toBeTruthy();
  });

  it("sets Authorization header starting with OSS {accessKeyId}:", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await adapter.put("x.png", new Uint8Array([0]), "image/png");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    const authHeader = headers.get("Authorization")!;
    expect(authHeader).toMatch(/^OSS testAKID:/);
  });

  it("produces the correct deterministic HMAC-SHA1 signature", async () => {
    // We capture the Date header that the adapter uses, then recompute the
    // expected signature independently and compare.
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () => Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const key = "adhoc/u1/pic.jpg";
    await adapter.put(key, new Uint8Array([7, 8, 9]), "image/jpeg");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    const date = headers.get("Date")!;
    const authHeader = headers.get("Authorization")!;

    const expectedSig = computeExpectedSig(OPTS, {
      verb: "PUT",
      contentType: "image/jpeg",
      date,
      key,
    });
    expect(authHeader).toBe(`OSS ${OPTS.accessKeyId}:${expectedSig}`);
  });

  it("throws on non-2xx response", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response("<Error>AccessDenied</Error>", { status: 403 }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await expect(
      adapter.put("x.png", new Uint8Array([0]), "image/png"),
    ).rejects.toThrow(/403/);
  });
});

// ---------------------------------------------------------------------------
// getBytes()
// ---------------------------------------------------------------------------
describe("AliyunOssAdapter.getBytes", () => {
  it("returns Uint8Array matching response bytes on 200", async () => {
    const expectedBytes = new Uint8Array([10, 20, 30, 40]);
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response(expectedBytes.buffer as ArrayBuffer, { status: 200 }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const result = await adapter.getBytes("some/path/file.png");
    expect(result).toEqual(expectedBytes);
  });

  it("returns null on 404", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response("<Error><Code>NoSuchKey</Code></Error>", {
            status: 404,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const result = await adapter.getBytes("nonexistent.png");
    expect(result).toBeNull();
  });

  it("throws on 500 response", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response("<Error>InternalError</Error>", { status: 500 }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await expect(adapter.getBytes("some/key.png")).rejects.toThrow(/500/);
  });

  it("issues a GET to the correct virtual-hosted URL", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1]).buffer as ArrayBuffer, {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await adapter.getBytes("images/photo.jpg");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://my-bucket.oss-cn-beijing.aliyuncs.com/images/photo.jpg",
    );
    expect((init as RequestInit).method).toBe("GET");
  });

  it("sets Authorization header starting with OSS {accessKeyId}: on GET", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([0]).buffer as ArrayBuffer, {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    await adapter.getBytes("x.png");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    expect(headers.get("Authorization")).toMatch(/^OSS testAKID:/);
  });

  it("produces the correct deterministic HMAC-SHA1 signature for GET", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([5]).buffer as ArrayBuffer, {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    const key = "adhoc/u2/shot.jpg";
    await adapter.getBytes(key);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init!.headers as Record<string, string>);
    const date = headers.get("Date")!;
    const authHeader = headers.get("Authorization")!;

    const expectedSig = computeExpectedSig(OPTS, {
      verb: "GET",
      contentType: "",
      date,
      key,
    });
    expect(authHeader).toBe(`OSS ${OPTS.accessKeyId}:${expectedSig}`);
  });
});

// ---------------------------------------------------------------------------
// Key encoding — path segments with special characters
// ---------------------------------------------------------------------------
describe("AliyunOssAdapter key encoding", () => {
  it("percent-encodes path segments that contain special chars, but keeps slashes", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([0]).buffer as ArrayBuffer, {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AliyunOssAdapter(OPTS);
    // Key contains a space and a Chinese character
    await adapter.getBytes("folder/文件 name.png");

    const [url] = fetchMock.mock.calls[0]!;
    // Slashes preserved; individual segment chars encoded
    expect(url as string).toContain(
      "my-bucket.oss-cn-beijing.aliyuncs.com/folder/",
    );
    // The slash between segments must NOT be double-encoded
    expect(url as string).not.toContain("%2F");
  });
});
