import "server-only";
import { buildStorageAdapter, type StorageAdapter } from "@zhijiao/integrations";

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!cached) cached = buildStorageAdapter(process.env);
  return cached;
}
