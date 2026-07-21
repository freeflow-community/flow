// Blob storage seam (phase2.md §3): a minimal put/get/delete-by-key interface so
// phase 3 can swap the local directory for object storage without touching routes
// or services. Keys are always server-generated (never derived from user input),
// so the local driver needs no path-sanitization gymnastics — but it still
// refuses keys that would escape the root, as defense in depth.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { R2Store } from './r2.js';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Object size, or null if the key doesn't exist. */
  head(key: string): Promise<{ size: number } | null>;
  /**
   * Direct-upload URL for exactly contentLength bytes of contentType, or null
   * when the driver can't mint one (local dev) — the caller then falls back to
   * a server-proxied upload URL so clients keep a single code path.
   */
  presignPut(key: string, opts: { contentType: string; contentLength: number }): Promise<PresignedUpload | null>;
  /** Short-lived direct-download URL, or null when the driver must proxy.
   * ttlSeconds overrides the default download TTL (used for streaming URLs). */
  presignGet(
    key: string,
    opts: { filename?: string; contentType?: string; inline?: boolean; ttlSeconds?: number },
  ): Promise<string | null>;
}

export class LocalDirStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const abs = path.resolve(this.root, key);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return abs;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const abs = this.resolve(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // write-then-rename for atomicity (no partial blobs on crash)
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, abs);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.resolve(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err; // idempotent delete
    });
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const st = await fs.stat(this.resolve(key));
      return { size: st.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async presignPut(): Promise<null> {
    return null;
  }

  async presignGet(): Promise<null> {
    return null;
  }
}

let store: BlobStore | null = null;

export function blobStore(): BlobStore {
  if (!store) {
    if (config.blobDriver === 'r2') {
      store = new R2Store(config.r2Bucket);
    } else {
      store = new LocalDirStore(config.fileDir);
    }
  }
  return store;
}

/** Tests only: inject a fake or reset the singleton. */
export function _setBlobStoreForTests(s: BlobStore | null): void {
  store = s;
}
