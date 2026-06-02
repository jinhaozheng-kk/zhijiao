export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}
