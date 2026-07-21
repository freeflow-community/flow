// One-time volume → R2 blob migration (decision log, 2026-07-20 R2 ruling).
//
// Copies every blob off the local disk store into R2, decrypting legacy
// AES-GCM envelopes on the way (R2-era blobs are plaintext; enc_key_id=NULL
// marks them). Idempotent: rows already migrated are skipped, so it's safe to
// re-run. Triggered at boot when FLOW_MIGRATE_BLOBS=1 (Railway has no one-off
// exec) — remove the env var after a clean run. The volume is left untouched
// as a rollback safety net; drop it once prod has been verified.
import fs from 'node:fs/promises';
import path from 'node:path';
import { isNull, not, and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { decryptBlob } from '../crypto/index.js';
import { blobStore, LocalDirStore } from '../storage/index.js';
import { config } from '../config.js';

const { files } = schema;

interface Log {
  info(o: unknown, msg: string): void;
  warn(o: unknown, msg: string): void;
}

export async function runBlobMigration(log: Log): Promise<void> {
  if (config.blobDriver !== 'r2') {
    log.warn({}, 'FLOW_MIGRATE_BLOBS set but FLOW_BLOB_DRIVER is not r2 — skipping');
    return;
  }
  const src = new LocalDirStore(config.fileDir);
  const dst = blobStore(); // r2
  let migrated = 0;
  let skipped = 0;
  let missing = 0;

  // 1) encrypted legacy file rows: decrypt → plaintext object in R2
  const rows = await db
    .select()
    .from(files)
    .where(and(isNull(files.deletedAt), not(isNull(files.encKeyId))));
  for (const f of rows) {
    const keys = [f.storageKey, ...(f.thumbKey ? [f.thumbKey] : [])];
    let ok = true;
    for (const key of keys) {
      let blob: Buffer;
      try {
        blob = await src.get(key);
      } catch {
        log.warn({ fileId: f.id, key }, 'blob missing on volume — row left encrypted');
        missing++;
        ok = false;
        break;
      }
      await dst.put(key, decryptBlob(blob, f.encKeyId!));
    }
    if (ok) {
      await db.update(files).set({ encKeyId: null }).where(eq(files.id, f.id));
      migrated++;
    }
  }

  // 2) avatars: stored unencrypted on disk, keyed avatars/<key>, tracked only
  // by users.avatar_url — enumerate the directory and copy verbatim
  let avatars = 0;
  const avatarDir = path.join(config.fileDir, 'avatars');
  const names = await fs.readdir(avatarDir).catch(() => [] as string[]);
  for (const name of names) {
    const key = `avatars/${name}`;
    if (await dst.head(key)) {
      skipped++;
      continue;
    }
    await dst.put(key, await src.get(key));
    avatars++;
  }

  log.info({ migrated, avatars, skipped, missing }, 'blob migration to R2 finished');
}
