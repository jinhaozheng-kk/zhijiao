import type { StorageAdapter } from "./types.js";

export class MockStorageAdapter implements StorageAdapter {
  private store = new Map<string, Uint8Array>();
  async put(
    key: string,
    bytes: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    this.store.set(key, bytes);
  }
  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.store.get(key) ?? null;
  }
}

// Shared singleton so the upload route and the AI read see the same bytes
// within one process under test / E2E hooks (mirrors sharedTestSmsAdapter).
export const sharedMockStorageAdapter = new MockStorageAdapter();
