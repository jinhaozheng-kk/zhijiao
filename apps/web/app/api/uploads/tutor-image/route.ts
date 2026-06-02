import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getShellIdentity } from "@/server/shell-identity";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const identity = await getShellIdentity();
  if (!identity) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }
  const ext = EXT[file.type];
  if (!ext) {
    return NextResponse.json({ error: "UNSUPPORTED_TYPE" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "TOO_LARGE" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageKey = `adhoc/${identity.userId}/${randomUUID()}.${ext}`;
  await getStorage().put(imageKey, bytes, file.type);
  return NextResponse.json({ imageKey });
}
