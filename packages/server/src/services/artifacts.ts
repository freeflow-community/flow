// Artifact tabs (phase9.md): personal per-user bookmarks of shared files.
// Rulings (decision log 2026-07-21): artifacts are personal; removing one
// never deletes the file; an agent shares an artifact with ONE person, not a
// whole channel. Events ride the per-user notify subject — the owner's other
// clients stay in sync, nobody else hears about it.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ArtifactDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { forbidden, notFound } from '../lib/errors.js';
import { requireFileAccess, toFileDTO } from './files.js';
import { publishEvent, subjectUserNotify } from '../bus.js';

const { artifacts, files, channelMembers } = schema;

type ArtifactRow = typeof artifacts.$inferSelect;
type FileRow = typeof files.$inferSelect;

function toArtifactDTO(a: ArtifactRow, f: FileRow): ArtifactDTO {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    userId: a.userId,
    fileId: a.fileId,
    name: a.name,
    createdAt: a.createdAt.toISOString(),
    file: toFileDTO(f),
  };
}

function publishArtifactEvent(type: 'artifact.created' | 'artifact.updated' | 'artifact.deleted', dto: ArtifactDTO): void {
  publishEvent(subjectUserNotify(dto.userId), {
    type,
    workspaceId: dto.workspaceId,
    ts: new Date().toISOString(),
    data: dto,
  });
}

/** Bookmark a file for one user. Idempotent per (user, file) — re-bookmarking
 * returns the existing artifact untouched. */
export async function createArtifact(userId: string, fileId: string, name?: string): Promise<ArtifactDTO> {
  const f = await requireFileAccess(fileId, userId);
  const inserted = await db
    .insert(artifacts)
    .values({ id: newId(), userId, workspaceId: f.workspaceId, fileId, name: name ?? f.name })
    .onConflictDoNothing({ target: [artifacts.userId, artifacts.fileId] })
    .returning();
  if (inserted.length === 0) {
    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.userId, userId), eq(artifacts.fileId, fileId)))
      .limit(1);
    return toArtifactDTO(existing[0]!, f);
  }
  const dto = toArtifactDTO(inserted[0]!, f);
  publishArtifactEvent('artifact.created', dto);
  return dto;
}

/**
 * MCP share (POST /v1/artifacts/share): create an artifact in ONE other
 * person's sidebar — an agent works for a person, not a room (operator
 * correction 2026-07-21, superseding the channel fan-out).
 *
 * Authorization is "the caller shares a channel with the recipient" rather
 * than "the caller names a channel": it keeps the anti-spam property (an
 * agent can only reach people it already shares a channel with) without
 * requiring conversation context, so an agent running outside a channel can
 * still deliver to a known user. Returns the existing row unchanged if the
 * recipient already bookmarked this file.
 */
export async function shareArtifactWith(
  targetUserId: string,
  callerId: string,
  fileId: string,
  name?: string,
): Promise<ArtifactDTO> {
  const f = await requireFileAccess(fileId, callerId);
  if (targetUserId !== callerId) {
    const callerChannels = db
      .select({ id: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, callerId));
    const shared = await db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(and(eq(channelMembers.userId, targetUserId), inArray(channelMembers.channelId, callerChannels)))
      .limit(1);
    if (shared.length === 0) throw forbidden('you can only send artifacts to people you share a channel with');
  }

  const inserted = await db
    .insert(artifacts)
    .values({ id: newId(), userId: targetUserId, workspaceId: f.workspaceId, fileId, name: name ?? f.name })
    .onConflictDoNothing({ target: [artifacts.userId, artifacts.fileId] })
    .returning();
  if (inserted.length === 0) {
    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.userId, targetUserId), eq(artifacts.fileId, fileId)))
      .limit(1);
    return toArtifactDTO(existing[0]!, f);
  }
  const dto = toArtifactDTO(inserted[0]!, f);
  publishArtifactEvent('artifact.created', dto);
  return dto;
}

/** The caller's artifacts in one workspace, newest first. Artifacts whose file
 * was since deleted are hidden (the row cascades away on hard delete; soft
 * delete just hides it). */
export async function listArtifacts(workspaceId: string, userId: string): Promise<ArtifactDTO[]> {
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .innerJoin(files, eq(files.id, artifacts.fileId))
    .where(and(eq(artifacts.userId, userId), eq(artifacts.workspaceId, workspaceId)))
    .orderBy(desc(artifacts.createdAt));
  return rows.filter((r) => r.f.deletedAt === null).map((r) => toArtifactDTO(r.a, r.f));
}

async function requireOwned(artifactId: string, userId: string): Promise<{ a: ArtifactRow; f: FileRow }> {
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .innerJoin(files, eq(files.id, artifacts.fileId))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  const row = rows[0];
  if (!row || row.a.userId !== userId) throw notFound('artifact not found');
  return row;
}

export async function renameArtifact(artifactId: string, userId: string, name: string): Promise<ArtifactDTO> {
  const { f } = await requireOwned(artifactId, userId);
  const updated = await db.update(artifacts).set({ name }).where(eq(artifacts.id, artifactId)).returning();
  const dto = toArtifactDTO(updated[0]!, f);
  publishArtifactEvent('artifact.updated', dto);
  return dto;
}

/** Remove the bookmark. The file is never touched (operator ruling). */
export async function deleteArtifact(artifactId: string, userId: string): Promise<void> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  const a = rows[0];
  if (!a) return; // idempotent
  if (a.userId !== userId) throw notFound('artifact not found');
  const fRows = await db.select().from(files).where(eq(files.id, a.fileId)).limit(1);
  await db.delete(artifacts).where(eq(artifacts.id, artifactId));
  if (fRows[0]) publishArtifactEvent('artifact.deleted', toArtifactDTO(a, fRows[0]));
}
