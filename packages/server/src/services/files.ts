// Files: blobs + thumbnails (phase2.md §3), R2-era direct uploads (2026-07-20).
//
// Upload-then-attach: clients either POST multipart to /files (legacy path,
// server writes the blob) or presign→PUT→complete (direct-to-R2; the server
// never sees the bytes). New blobs are stored as PLAINTEXT — R2 encrypts at
// rest and every URL is minted after an access check (decision log, R2
// ruling). Legacy rows (enc_key_id set) still decrypt through the keyring.
// Orphaned uploads — never attached, or presigned but never completed — are
// swept at boot + daily in-process (decision log ruling 5).
import path from 'node:path';
import sharp from 'sharp';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FileDTO, PresignedUploadDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { decryptBlob } from '../crypto/index.js';
import { blobStore } from '../storage/index.js';
import { config } from '../config.js';
import { requireMembership } from './workspaces.js';
import { requireChannelAccess } from './channels.js';

// `artifacts` is used for the phase-9 access grant below — the table only, not
// the artifacts service, so there's no import cycle (that service imports us).
const { files, messageFiles, messages, artifacts } = schema;

type FileRow = typeof files.$inferSelect;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function toFileDTO(f: FileRow): FileDTO {
  return {
    id: f.id,
    workspaceId: f.workspaceId,
    userId: f.userId,
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    hasThumb: f.thumbKey !== null,
    createdAt: f.createdAt.toISOString(),
  };
}

/** Multipart upload → encrypted blob (+ thumbnail for images) → files row. */
export async function uploadFile(
  workspaceId: string,
  userId: string,
  filename: string,
  mimeType: string,
  data: Buffer,
): Promise<FileDTO> {
  await requireMembership(workspaceId, userId);
  if (data.length === 0) throw badRequest('empty_file', 'file is empty');
  if (data.length > config.maxServerUploadBytes) {
    // this path buffers server-side; bigger files must use the presign flow
    throw badRequest('file_too_large', `multipart uploads are limited to ${config.maxServerUploadBytes} bytes`);
  }

  const id = newId();
  const storageKey = `files/${id}`;
  // sanitize the original name for display: strip any path components
  const name = path.basename(filename || 'file').slice(0, 255) || 'file';

  const store = blobStore();
  await store.put(storageKey, data);
  const { width, height, thumbKey } = await makeThumbnail(id, mimeType, data);

  const inserted = await db
    .insert(files)
    .values({
      id,
      workspaceId,
      userId,
      name,
      mimeType,
      sizeBytes: data.length,
      storageKey,
      encKeyId: null,
      width,
      height,
      thumbKey,
    })
    .returning();
  return toFileDTO(inserted[0]!);
}

/** Image sidecar: dimensions + max-512px webp thumbnail stored at thumbs/<id>. */
async function makeThumbnail(
  id: string,
  mimeType: string,
  data: Buffer,
): Promise<{ width: number | null; height: number | null; thumbKey: string | null }> {
  if (!IMAGE_MIMES.has(mimeType)) return { width: null, height: null, thumbKey: null };
  try {
    const img = sharp(data, { animated: false });
    const meta = await img.metadata();
    // max-512px thumbnail (fit inside, never enlarge), webp keeps alpha
    const thumb = await img
      .resize({ width: config.thumbMaxPx, height: config.thumbMaxPx, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const thumbKey = `thumbs/${id}`;
    await blobStore().put(thumbKey, thumb);
    return { width: meta.width ?? null, height: meta.height ?? null, thumbKey };
  } catch {
    // not actually a decodable image — keep the file, skip the preview
    return { width: null, height: null, thumbKey: null };
  }
}

/**
 * Presigned direct upload, step 1: reserve a files row ('pending') and mint an
 * upload URL. On R2 the URL goes straight to the bucket with the declared
 * content-length/type baked into the signature (the size cap holds without the
 * server seeing bytes). On the local driver we fall back to a server-proxied
 * PUT (/v1/files/:id/content) so clients keep a single code path.
 */
export async function createPresignedUpload(
  workspaceId: string,
  userId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
): Promise<PresignedUploadDTO> {
  await requireMembership(workspaceId, userId);
  if (sizeBytes <= 0) throw badRequest('empty_file', 'file is empty');
  if (sizeBytes > config.maxFileBytes) {
    throw badRequest('file_too_large', `files are limited to ${config.maxFileBytes} bytes`);
  }

  const id = newId();
  const storageKey = `files/${id}`;
  const name = path.basename(filename || 'file').slice(0, 255) || 'file';

  const inserted = await db
    .insert(files)
    .values({
      id,
      workspaceId,
      userId,
      name,
      mimeType,
      sizeBytes,
      storageKey,
      encKeyId: null,
      status: 'pending',
    })
    .returning();

  const presigned = await blobStore().presignPut(storageKey, { contentType: mimeType, contentLength: sizeBytes });
  const upload = presigned ?? {
    url: `/v1/files/${id}/content`,
    method: 'PUT' as const,
    headers: { 'content-type': mimeType },
  };
  return { file: toFileDTO(inserted[0]!), upload };
}

/** Local-driver fallback for the presigned flow: accept the bytes ourselves. */
export async function putPendingContent(fileId: string, userId: string, data: Buffer): Promise<void> {
  const f = await requirePendingOwned(fileId, userId);
  // mirror R2's signed-content-length contract: the declared size is binding
  if (data.length !== f.sizeBytes) {
    throw badRequest('size_mismatch', `expected ${f.sizeBytes} bytes, got ${data.length}`);
  }
  await blobStore().put(f.storageKey, data);
}

/**
 * Presigned direct upload, step 2: client says the PUT finished. Verify the
 * object really exists with the declared size, generate the image sidecar
 * (dimensions + thumbnail), and flip the row to 'ready'. Idempotent.
 */
export async function completeUpload(fileId: string, userId: string): Promise<FileDTO> {
  const rows = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
  const f = rows[0];
  if (!f || f.userId !== userId) throw notFound('file not found');
  if (f.status === 'ready') return toFileDTO(f);

  const store = blobStore();
  const head = await store.head(f.storageKey);
  if (!head) throw badRequest('upload_incomplete', 'no object was uploaded for this file');
  if (head.size !== f.sizeBytes) {
    // R2 signs content-length so this can't happen there; guards the local fallback
    throw badRequest('size_mismatch', `expected ${f.sizeBytes} bytes, found ${head.size}`);
  }

  let sidecar: { width: number | null; height: number | null; thumbKey: string | null } = {
    width: null,
    height: null,
    thumbKey: null,
  };
  // sidecar generation pulls the object into memory — skip absurdly large "images"
  if (IMAGE_MIMES.has(f.mimeType) && f.sizeBytes <= config.thumbSourceMaxBytes) {
    sidecar = await makeThumbnail(f.id, f.mimeType, await store.get(f.storageKey));
  }

  const updated = await db
    .update(files)
    .set({ status: 'ready', width: sidecar.width, height: sidecar.height, thumbKey: sidecar.thumbKey })
    .where(and(eq(files.id, fileId), eq(files.status, 'pending')))
    .returning();
  // lost a race with a concurrent complete — both saw the same object, re-read is safe
  return toFileDTO(updated[0] ?? { ...f, status: 'ready', ...sidecar });
}

async function requirePendingOwned(fileId: string, userId: string): Promise<FileRow> {
  const rows = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
  const f = rows[0];
  if (!f || f.userId !== userId) throw notFound('file not found');
  if (f.status !== 'pending') throw badRequest('already_uploaded', 'file upload was already completed');
  return f;
}

/**
 * Access rule: the uploader can always fetch; anyone else must be a workspace
 * member AND either hold an artifact bookmark of the file (phase 9) or the
 * file must be attached to at least one message in a channel they can access
 * (public → workspace member; private → channel member). Otherwise unattached
 * files are visible to the uploader only.
 */
export async function requireFileAccess(fileId: string, userId: string): Promise<FileRow> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt), eq(files.status, 'ready')))
    .limit(1);
  const f = rows[0];
  if (!f) throw notFound('file not found');
  if (f.userId === userId) return f;
  await requireMembership(f.workspaceId, userId); // 404s non-members without leaking

  // A channel artifact backed by this file is itself the grant (phase 13):
  // if the file backs an artifact in a channel this user can access, they can
  // read it. Agent-generated artifact files are never attached to a message,
  // so without this a channel member couldn't render the artifact.
  const pinned = await db
    .select({ channelId: artifacts.channelId })
    .from(artifacts)
    .where(eq(artifacts.fileId, fileId))
    .groupBy(artifacts.channelId);
  for (const p of pinned) {
    try {
      await requireChannelAccess(p.channelId, userId);
      return f;
    } catch {
      /* try the next channel this file is pinned in */
    }
  }

  const attached = await db
    .select({ channelId: messages.channelId })
    .from(messageFiles)
    .innerJoin(messages, eq(messages.id, messageFiles.messageId))
    .where(eq(messageFiles.fileId, fileId))
    .groupBy(messages.channelId);
  for (const a of attached) {
    try {
      await requireChannelAccess(a.channelId, userId);
      return f;
    } catch {
      /* try the next channel this file is attached in */
    }
  }
  throw notFound('file not found');
}

export interface FileContent {
  data: Buffer;
  mimeType: string;
  name: string;
}

/** Access-checked download: a short-lived signed URL when the driver can mint
 * one (client is 302'd straight to R2), else the proxied bytes. */
export type FileDownload = { redirect: string } | { content: FileContent };

function readBlob(key: string, encKeyId: string | null): Promise<Buffer> {
  return blobStore()
    .get(key)
    .then((blob) => (encKeyId ? decryptBlob(blob, encKeyId) : blob));
}

export async function getFileDownload(fileId: string, userId: string): Promise<FileDownload> {
  const f = await requireFileAccess(fileId, userId);
  if (!f.encKeyId) {
    // legacy encrypted rows can't be served by R2 directly — proxy those
    const url = await blobStore().presignGet(f.storageKey, { filename: f.name, contentType: f.mimeType });
    if (url) return { redirect: url };
  }
  return { content: { data: await readBlob(f.storageKey, f.encKeyId), mimeType: f.mimeType, name: f.name } };
}

/** In-place streaming URL (e.g. <video src>): a longer-TTL presigned GET so
 * playback and seeking survive a feature-length video, or null when the driver
 * can't presign (local dev) / the row is legacy-encrypted — the client then
 * falls back to fetching the bytes through the proxy route. */
export async function getStreamUrl(
  fileId: string,
  userId: string,
): Promise<{ url: string | null; expiresInSeconds: number }> {
  const f = await requireFileAccess(fileId, userId);
  if (f.encKeyId) return { url: null, expiresInSeconds: 0 };
  const url = await blobStore().presignGet(f.storageKey, {
    contentType: f.mimeType,
    inline: true,
    ttlSeconds: config.streamUrlTtlSeconds,
  });
  return { url, expiresInSeconds: url ? config.streamUrlTtlSeconds : 0 };
}

export async function getThumbDownload(fileId: string, userId: string): Promise<FileDownload> {
  const f = await requireFileAccess(fileId, userId);
  if (!f.thumbKey) throw notFound('no thumbnail for this file');
  if (!f.encKeyId) {
    const url = await blobStore().presignGet(f.thumbKey, { contentType: 'image/webp', inline: true });
    if (url) return { redirect: url };
  }
  return {
    content: { data: await readBlob(f.thumbKey, f.encKeyId), mimeType: 'image/webp', name: `${f.name}.thumb.webp` },
  };
}

/**
 * Validate that fileIds may be attached by this sender to a message in this
 * workspace: files must exist, live in the same workspace, and belong to the
 * sender (you attach your own uploads). Returns rows for DTO hydration.
 */
export async function validateAttachments(
  fileIds: string[],
  workspaceId: string,
  senderId: string,
): Promise<FileRow[]> {
  if (fileIds.length === 0) return [];
  if (fileIds.length > config.maxFilesPerMessage) {
    throw badRequest('too_many_files', `at most ${config.maxFilesPerMessage} files per message`);
  }
  const rows = await db
    .select()
    .from(files)
    .where(and(inArray(files.id, fileIds), isNull(files.deletedAt), eq(files.status, 'ready')));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const fid of fileIds) {
    const f = byId.get(fid);
    if (!f || f.workspaceId !== workspaceId) throw badRequest('bad_file', `file ${fid} not found in this workspace`);
    if (f.userId !== senderId) throw badRequest('bad_file', `file ${fid} was not uploaded by you`);
  }
  // de-dupe, preserving order
  return [...new Set(fileIds)].map((fid) => byId.get(fid)!);
}

/** Files attached to a set of messages, for DTO hydration. Returns messageId -> FileDTO[]. */
export async function filesForMessages(messageIds: string[]): Promise<Map<string, FileDTO[]>> {
  const out = new Map<string, FileDTO[]>();
  if (messageIds.length === 0) return out;
  const rows = await db
    .select({ messageId: messageFiles.messageId, f: files })
    .from(messageFiles)
    .innerJoin(files, eq(files.id, messageFiles.fileId))
    .where(inArray(messageFiles.messageId, messageIds))
    .orderBy(files.id);
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    list.push(toFileDTO(r.f));
    out.set(r.messageId, list);
  }
  return out;
}

/**
 * Orphan sweep (decision log ruling 5): hard-delete files never attached to a
 * message within 24h, blobs included. Runs at boot and on a daily in-process
 * timer — no scheduler infrastructure. Avatars never enter the files table
 * (approved deviation), so no special-casing here.
 */
export async function sweepOrphanFiles(): Promise<number> {
  const cutoff = new Date(Date.now() - config.orphanFileTtlHours * 3600_000);
  const orphans = await db
    .select({ id: files.id, storageKey: files.storageKey, thumbKey: files.thumbKey })
    .from(files)
    .where(
      and(
        lt(files.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM message_files mf WHERE mf.file_id = ${files.id})`,
        // phase 9: artifact-only files (e.g. MCP create_artifact uploads) are
        // never attached to a message but must not be reaped
        sql`NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.file_id = ${files.id})`,
      ),
    );
  const store = blobStore();
  for (const o of orphans) {
    await db.delete(files).where(eq(files.id, o.id));
    await store.delete(o.storageKey);
    if (o.thumbKey) await store.delete(o.thumbKey);
  }
  return orphans.length;
}

/** Phase 13: delete a file + its blob iff nothing references it — no message
 * attachment and no (other) artifact. Used when an owned artifact is deleted or
 * re-pointed at a new file; a file still shared in a message or pinned
 * elsewhere is kept untouched. Best-effort: never throws. */
export async function reapFileIfUnreferenced(fileId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: files.id, storageKey: files.storageKey, thumbKey: files.thumbKey })
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          sql`NOT EXISTS (SELECT 1 FROM message_files mf WHERE mf.file_id = ${files.id})`,
          sql`NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.file_id = ${files.id})`,
        ),
      )
      .limit(1);
    const f = rows[0];
    if (!f) return false; // still referenced — leave it
    const store = blobStore();
    await db.delete(files).where(eq(files.id, f.id));
    await store.delete(f.storageKey);
    if (f.thumbKey) await store.delete(f.thumbKey);
    return true;
  } catch {
    return false;
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Boot-time sweep + daily timer. Errors are logged by the caller; never fatal. */
export function startOrphanSweep(log: { info(o: unknown, msg: string): void; error(o: unknown, msg: string): void }): void {
  const run = async () => {
    try {
      const n = await sweepOrphanFiles();
      if (n > 0) log.info({ swept: n }, 'orphan file sweep');
    } catch (err) {
      log.error(err, 'orphan file sweep failed');
    }
  };
  void run();
  if (!sweepTimer) {
    sweepTimer = setInterval(run, 24 * 3600_000);
    sweepTimer.unref();
  }
}
