// Files: encrypted blobs + thumbnails (phase2.md §3).
//
// Upload-then-attach: POST /files returns a fileId; the client references it in
// a later message send. Blobs and thumbnails are AES-256-GCM envelope-encrypted
// (nonce prepended) — the storage layer only ever sees ciphertext. Orphaned
// uploads (never attached within 24h) are swept at boot + daily in-process
// (decision log ruling 5 — no scheduler infrastructure).
//
// NOTE on "streamed" downloads: with a 20 MB cap we buffer whole blobs — GCM
// must verify the auth tag before any plaintext can be trusted anyway, and
// buffering keeps unauthenticated bytes from ever leaving the process.
import path from 'node:path';
import sharp from 'sharp';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FileDTO } from '@mychat/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { encryptBlob, decryptBlob } from '../crypto/index.js';
import { blobStore } from '../storage/index.js';
import { config } from '../config.js';
import { requireMembership } from './workspaces.js';
import { requireChannelAccess } from './channels.js';

const { files, messageFiles, messages } = schema;

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
  if (data.length > config.maxFileBytes) {
    throw badRequest('file_too_large', `files are limited to ${config.maxFileBytes} bytes`);
  }

  const id = newId();
  const storageKey = `files/${id}`;
  // sanitize the original name for display: strip any path components
  const name = path.basename(filename || 'file').slice(0, 255) || 'file';

  let width: number | null = null;
  let height: number | null = null;
  let thumbKey: string | null = null;

  const store = blobStore();
  const enc = encryptBlob(data);
  await store.put(storageKey, enc.blob);

  if (IMAGE_MIMES.has(mimeType)) {
    try {
      const img = sharp(data, { animated: false });
      const meta = await img.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      // max-512px thumbnail (fit inside, never enlarge), webp keeps alpha
      const thumb = await img
        .resize({ width: config.thumbMaxPx, height: config.thumbMaxPx, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      thumbKey = `thumbs/${id}`;
      const encThumb = encryptBlob(thumb);
      await store.put(thumbKey, encThumb.blob);
    } catch {
      // not actually a decodable image — keep the file, skip the preview
      width = height = null;
      thumbKey = null;
    }
  }

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
      encKeyId: enc.encKeyId,
      width,
      height,
      thumbKey,
    })
    .returning();
  return toFileDTO(inserted[0]!);
}

/**
 * Access rule: the uploader can always fetch; anyone else must be a workspace
 * member AND the file must be attached to at least one message in a channel
 * they can access (public → workspace member; private → channel member).
 * Unattached files are visible to the uploader only.
 */
async function requireFileAccess(fileId: string, userId: string): Promise<FileRow> {
  const rows = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
  const f = rows[0];
  if (!f) throw notFound('file not found');
  if (f.userId === userId) return f;
  await requireMembership(f.workspaceId, userId); // 404s non-members without leaking
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

export async function getFileContent(fileId: string, userId: string): Promise<FileContent> {
  const f = await requireFileAccess(fileId, userId);
  const blob = await blobStore().get(f.storageKey);
  return { data: decryptBlob(blob, f.encKeyId), mimeType: f.mimeType, name: f.name };
}

export async function getThumbContent(fileId: string, userId: string): Promise<FileContent> {
  const f = await requireFileAccess(fileId, userId);
  if (!f.thumbKey) throw notFound('no thumbnail for this file');
  const blob = await blobStore().get(f.thumbKey);
  return { data: decryptBlob(blob, f.encKeyId), mimeType: 'image/webp', name: `${f.name}.thumb.webp` };
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
    .where(and(inArray(files.id, fileIds), isNull(files.deletedAt)));
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
