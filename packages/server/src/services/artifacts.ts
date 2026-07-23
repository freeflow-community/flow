// Artifacts (phase 13): per-channel shared objects — a named file pinned to a
// channel, visible to every member (privacy = use a private channel). The
// backing file is mutable: an agent "updates" an artifact by re-pointing it at
// a freshly uploaded file. owns_file marks artifacts whose file was uploaded
// for them (agent-generated), so deleting/re-pointing can reap the file.
//
// Supersedes the phase-9 per-user model (operator ruling 2026-07-23): artifacts
// were personal bookmarks fanned out per recipient; they are now shared per
// channel. Events ride a per-channel subject; the gateway's visible() filter
// gates them by channel membership, so private channels stay private.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ArtifactDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { forbidden, notFound } from '../lib/errors.js';
import { reapFileIfUnreferenced, requireFileAccess, toFileDTO } from './files.js';
import { requireChannelAccess } from './channels.js';
import { publishEvent, subjectArtifact } from '../bus.js';

const { artifacts, files, channelMembers } = schema;

type ArtifactRow = typeof artifacts.$inferSelect;
type FileRow = typeof files.$inferSelect;

function toArtifactDTO(a: ArtifactRow, f: FileRow): ArtifactDTO {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    channelId: a.channelId,
    fileId: a.fileId,
    name: a.name,
    ownsFile: a.ownsFile,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    file: toFileDTO(f),
  };
}

function publishArtifactEvent(type: 'artifact.created' | 'artifact.updated' | 'artifact.deleted', dto: ArtifactDTO): void {
  publishEvent(subjectArtifact(dto.workspaceId, dto.channelId), {
    type,
    workspaceId: dto.workspaceId,
    channelId: dto.channelId,
    ts: new Date().toISOString(),
    data: dto,
  });
}

/** Require the caller to be a member of the channel (not just able to see it).
 * Managing shared artifacts is a member action. */
async function requireChannelMember(channelId: string, userId: string) {
  const { chan, isMember } = await requireChannelAccess(channelId, userId);
  if (!isMember) throw forbidden('join the channel to manage its artifacts');
  return chan;
}

/**
 * Pin a file as an artifact in a channel. Any member can pin. The pin path
 * (ownsFile=false) is idempotent per (channel, file) — re-pinning returns the
 * existing row untouched. Owned artifacts (ownsFile=true, an agent uploaded the
 * file for this artifact) are always distinct rows.
 */
export async function createArtifact(
  userId: string,
  channelId: string,
  opts: { fileId: string; name?: string | undefined; ownsFile?: boolean | undefined },
): Promise<ArtifactDTO> {
  const chan = await requireChannelMember(channelId, userId);
  const f = await requireFileAccess(opts.fileId, userId);
  const ownsFile = opts.ownsFile ?? false;

  if (!ownsFile) {
    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.channelId, channelId), eq(artifacts.fileId, opts.fileId), eq(artifacts.ownsFile, false)))
      .limit(1);
    if (existing[0]) return toArtifactDTO(existing[0], f);
  }

  const inserted = await db
    .insert(artifacts)
    .values({
      id: newId(),
      workspaceId: chan.workspaceId,
      channelId,
      fileId: opts.fileId,
      ownsFile,
      name: opts.name ?? f.name,
      createdBy: userId,
    })
    .returning();
  const dto = toArtifactDTO(inserted[0]!, f);
  publishArtifactEvent('artifact.created', dto);
  return dto;
}

/** The caller's visible artifacts in a workspace — those in channels they're a
 * member of, newest first. Artifacts whose file was since soft-deleted are
 * hidden. Clients group by channelId to nest under each channel. */
export async function listArtifacts(workspaceId: string, userId: string): Promise<ArtifactDTO[]> {
  const memberChannels = db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .innerJoin(files, eq(files.id, artifacts.fileId))
    .where(and(eq(artifacts.workspaceId, workspaceId), inArray(artifacts.channelId, memberChannels)))
    .orderBy(desc(artifacts.createdAt));
  return rows.filter((r) => r.f.deletedAt === null).map((r) => toArtifactDTO(r.a, r.f));
}

async function requireArtifactMember(artifactId: string, userId: string): Promise<{ a: ArtifactRow; f: FileRow }> {
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .innerJoin(files, eq(files.id, artifacts.fileId))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('artifact not found');
  await requireChannelMember(row.a.channelId, userId);
  return row;
}

/**
 * Rename and/or re-point at a new file (the agent "update" path). If the file
 * changes and the old file was owned by this artifact, the old file is reaped
 * once unreferenced. Any channel member may update.
 */
export async function updateArtifact(
  artifactId: string,
  userId: string,
  patch: { name?: string | undefined; fileId?: string | undefined; ownsFile?: boolean | undefined },
): Promise<ArtifactDTO> {
  const { a } = await requireArtifactMember(artifactId, userId);
  const set: Partial<ArtifactRow> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  let newFile: FileRow | null = null;
  const oldFileId = a.fileId;
  const oldOwned = a.ownsFile;
  if (patch.fileId !== undefined && patch.fileId !== a.fileId) {
    newFile = await requireFileAccess(patch.fileId, userId);
    set.fileId = patch.fileId;
    set.ownsFile = patch.ownsFile ?? false;
  } else if (patch.ownsFile !== undefined) {
    set.ownsFile = patch.ownsFile;
  }

  const updated = await db.update(artifacts).set(set).where(eq(artifacts.id, artifactId)).returning();
  const row = updated[0]!;
  // Re-pointed to a new file: reap the old one if this artifact owned it and
  // nothing else references it now.
  if (newFile && oldOwned && oldFileId !== row.fileId) {
    await reapFileIfUnreferenced(oldFileId);
  }
  const f = newFile ?? (await db.select().from(files).where(eq(files.id, row.fileId)).limit(1))[0]!;
  const dto = toArtifactDTO(row, f);
  publishArtifactEvent('artifact.updated', dto);
  return dto;
}

/** Rename an artifact (thin wrapper over updateArtifact for the PATCH route). */
export async function renameArtifact(artifactId: string, userId: string, name: string): Promise<ArtifactDTO> {
  return updateArtifact(artifactId, userId, { name });
}

/** Delete an artifact. If it owned its backing file, reap the file too (guarded
 * — a file still attached to a message or pinned elsewhere is kept). */
export async function deleteArtifact(artifactId: string, userId: string): Promise<void> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  const a = rows[0];
  if (!a) return; // idempotent
  await requireChannelMember(a.channelId, userId);
  const fRows = await db.select().from(files).where(eq(files.id, a.fileId)).limit(1);
  await db.delete(artifacts).where(eq(artifacts.id, artifactId));
  if (a.ownsFile) await reapFileIfUnreferenced(a.fileId);
  if (fRows[0]) publishArtifactEvent('artifact.deleted', toArtifactDTO(a, fRows[0]));
}
