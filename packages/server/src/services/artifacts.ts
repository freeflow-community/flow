// Artifacts (phase 13): per-channel shared objects — a named file pinned to a
// channel, visible to every member (privacy = use a private channel). The
// backing file is mutable: an agent "updates" an artifact by re-pointing it at
// a freshly uploaded file. owns_file marks artifacts whose file was uploaded
// for them (agent-generated), so deleting/re-pointing can reap the file.
//
// Link artifacts: a second kind — 'link' — pins a URL instead of a file. A link
// artifact opens in a shared "mini-browser" and is co-browsed: any member
// changing its url re-points the artifact (artifact.updated) and everyone's
// viewer follows. Link rows have url set and file_id null; the CHECK in
// migration 0020 keeps each row well-formed. Joins on files are therefore LEFT
// joins so link artifacts (no file) are not filtered out.
//
// Supersedes the phase-9 per-user model (operator ruling 2026-07-23): artifacts
// were personal bookmarks fanned out per recipient; they are now shared per
// channel. Events ride a per-channel subject; the gateway's visible() filter
// gates them by channel membership, so private channels stay private.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ArtifactDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { reapFileIfUnreferenced, requireFileAccess, toFileDTO } from './files.js';
import { requireChannelAccess } from './channels.js';
import { publishEvent, subjectArtifact } from '../bus.js';

const { artifacts, files, channelMembers } = schema;

type ArtifactRow = typeof artifacts.$inferSelect;
type FileRow = typeof files.$inferSelect;

function toArtifactDTO(a: ArtifactRow, f: FileRow | null): ArtifactDTO {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    channelId: a.channelId,
    kind: a.kind === 'link' ? 'link' : 'file',
    fileId: a.fileId,
    url: a.url,
    name: a.name,
    ownsFile: a.ownsFile,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    file: f ? toFileDTO(f) : null,
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

/** A friendly default name for a link artifact: the host without a leading www. */
function linkName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/**
 * Pin a file (`fileId`) or a link (`url`) as an artifact in a channel. Any
 * member can pin. Both pin paths are idempotent per channel — re-pinning the
 * same file (ownsFile=false) or the same url returns the existing row.  Owned
 * artifacts (ownsFile=true, an agent uploaded the file) are always distinct rows.
 */
export async function createArtifact(
  userId: string,
  channelId: string,
  opts: { fileId?: string | undefined; url?: string | undefined; name?: string | undefined; ownsFile?: boolean | undefined },
): Promise<ArtifactDTO> {
  const chan = await requireChannelMember(channelId, userId);

  // ---- link artifact -------------------------------------------------
  if (opts.url !== undefined) {
    if (!/^https?:\/\//i.test(opts.url)) throw badRequest('bad_url', 'url must be http(s)');
    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.channelId, channelId), eq(artifacts.kind, 'link'), eq(artifacts.url, opts.url)))
      .limit(1);
    if (existing[0]) return toArtifactDTO(existing[0], null);
    const inserted = await db
      .insert(artifacts)
      .values({
        id: newId(),
        workspaceId: chan.workspaceId,
        channelId,
        kind: 'link',
        url: opts.url,
        ownsFile: false,
        name: opts.name ?? linkName(opts.url),
        createdBy: userId,
      })
      .returning();
    const dto = toArtifactDTO(inserted[0]!, null);
    publishArtifactEvent('artifact.created', dto);
    return dto;
  }

  // ---- file artifact -------------------------------------------------
  if (opts.fileId === undefined) throw badRequest('bad_request', 'provide exactly one of fileId or url');
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
      kind: 'file',
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
 * member of, newest first. File artifacts whose file was since soft-deleted are
 * hidden; link artifacts always show. Clients group by channelId to nest under
 * each channel. */
export async function listArtifacts(workspaceId: string, userId: string): Promise<ArtifactDTO[]> {
  const memberChannels = db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .leftJoin(files, eq(files.id, artifacts.fileId))
    .where(and(eq(artifacts.workspaceId, workspaceId), inArray(artifacts.channelId, memberChannels)))
    .orderBy(desc(artifacts.createdAt));
  return rows
    .filter((r) => r.a.kind === 'link' || (r.f !== null && r.f.deletedAt === null))
    .map((r) => toArtifactDTO(r.a, r.f));
}

async function requireArtifactMember(artifactId: string, userId: string): Promise<{ a: ArtifactRow; f: FileRow | null }> {
  const rows = await db
    .select({ a: artifacts, f: files })
    .from(artifacts)
    .leftJoin(files, eq(files.id, artifacts.fileId))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('artifact not found');
  await requireChannelMember(row.a.channelId, userId);
  return row;
}

/**
 * Rename, re-point a file artifact at a new file (the agent "update" path), or
 * re-point a link artifact at a new url (the co-browse navigation path — this
 * is what a member's URL-bar edit persists, so every viewer follows). If a file
 * changes and the old file was owned by this artifact, the old file is reaped
 * once unreferenced. Any channel member may update.
 */
export async function updateArtifact(
  artifactId: string,
  userId: string,
  patch: { name?: string | undefined; fileId?: string | undefined; url?: string | undefined; ownsFile?: boolean | undefined },
): Promise<ArtifactDTO> {
  const { a } = await requireArtifactMember(artifactId, userId);
  const set: Partial<ArtifactRow> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;

  // Link artifacts only accept url (and name) changes; file artifacts only fileId.
  if (a.kind === 'link') {
    if (patch.fileId !== undefined) throw badRequest('bad_request', 'cannot attach a file to a link artifact');
    if (patch.url !== undefined && patch.url !== a.url) {
      if (!/^https?:\/\//i.test(patch.url)) throw badRequest('bad_url', 'url must be http(s)');
      set.url = patch.url;
    }
    const updated = await db.update(artifacts).set(set).where(eq(artifacts.id, artifactId)).returning();
    const dto = toArtifactDTO(updated[0]!, null);
    publishArtifactEvent('artifact.updated', dto);
    return dto;
  }

  if (patch.url !== undefined) throw badRequest('bad_request', 'cannot set a url on a file artifact');
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
  if (newFile && oldOwned && oldFileId && oldFileId !== row.fileId) {
    await reapFileIfUnreferenced(oldFileId);
  }
  const f = newFile ?? (row.fileId ? (await db.select().from(files).where(eq(files.id, row.fileId)).limit(1))[0]! : null);
  const dto = toArtifactDTO(row, f);
  publishArtifactEvent('artifact.updated', dto);
  return dto;
}

/** Rename an artifact (thin wrapper over updateArtifact for the PATCH route). */
export async function renameArtifact(artifactId: string, userId: string, name: string): Promise<ArtifactDTO> {
  return updateArtifact(artifactId, userId, { name });
}

/** Delete an artifact. If it owned its backing file, reap the file too (guarded
 * — a file still attached to a message or pinned elsewhere is kept). Link
 * artifacts have no file to reap. */
export async function deleteArtifact(artifactId: string, userId: string): Promise<void> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  const a = rows[0];
  if (!a) return; // idempotent
  await requireChannelMember(a.channelId, userId);
  const fRows = a.fileId ? await db.select().from(files).where(eq(files.id, a.fileId)).limit(1) : [];
  await db.delete(artifacts).where(eq(artifacts.id, artifactId));
  if (a.ownsFile && a.fileId) await reapFileIfUnreferenced(a.fileId);
  publishArtifactEvent('artifact.deleted', toArtifactDTO(a, fRows[0] ?? null));
}
