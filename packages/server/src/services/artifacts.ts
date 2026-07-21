// Artifact tabs (phase9.md): personal per-user bookmarks of shared files.
// Rulings (decision log 2026-07-21): artifacts are personal; removing one
// never deletes the file; the MCP fan-out creates one row per human member.
// Events ride the per-user notify subject — the owner's other clients stay in
// sync, nobody else hears about it.
import { and, desc, eq } from 'drizzle-orm';
import type { ArtifactDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { notFound } from '../lib/errors.js';
import { requireChannelAccess } from './channels.js';
import { requireFileAccess, toFileDTO } from './files.js';
import { publishEvent, subjectUserNotify } from '../bus.js';

const { artifacts, files, channelMembers, users } = schema;

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
 * MCP fan-out (POST /v1/channels/:id/artifacts): create a personal artifact
 * for every human member of the channel. The caller (typically an agent) must
 * be a channel member with access to the file; agents and app bots are
 * excluded as recipients — a robot has no sidebar to fill.
 */
export async function shareArtifact(
  channelId: string,
  callerId: string,
  fileId: string,
  name?: string,
): Promise<ArtifactDTO[]> {
  const { chan } = await requireChannelAccess(channelId, callerId);
  const f = await requireFileAccess(fileId, callerId);
  const members = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(and(eq(channelMembers.channelId, channelId), eq(users.isAgent, false), eq(users.isBot, false)));

  const out: ArtifactDTO[] = [];
  for (const m of members) {
    const inserted = await db
      .insert(artifacts)
      .values({ id: newId(), userId: m.userId, workspaceId: chan.workspaceId, fileId, name: name ?? f.name })
      .onConflictDoNothing({ target: [artifacts.userId, artifacts.fileId] })
      .returning();
    if (inserted.length === 0) continue; // already bookmarked — leave theirs alone
    const dto = toArtifactDTO(inserted[0]!, f);
    publishArtifactEvent('artifact.created', dto);
    out.push(dto);
  }
  return out;
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
