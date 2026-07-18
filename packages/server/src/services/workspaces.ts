import { and, eq, isNull, sql } from 'drizzle-orm';
import type { InviteDTO, MemberRole, WorkspaceDTO, WorkspaceMemberDTO } from '@mychat/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { publishEvent, subjectMeta, subjectUserMeta } from '../bus.js';

const { workspaces, workspaceMembers, invites, channels, channelMembers, users } = schema;

function toWorkspaceDTO(w: typeof workspaces.$inferSelect, role?: MemberRole): WorkspaceDTO {
  const dto: WorkspaceDTO = {
    id: w.id,
    slug: w.slug,
    name: w.name,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
  };
  if (role) dto.role = role;
  return dto;
}

export async function requireMembership(workspaceId: string, userId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  const m = rows[0];
  if (!m) throw notFound('workspace not found'); // don't leak existence
  return m;
}

/** Create workspace: creator becomes owner, #general auto-created (spec §4). */
export async function createWorkspace(userId: string, name: string, slug: string): Promise<WorkspaceDTO> {
  const wsId = newId();
  const chanId = newId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id: wsId, slug, name, createdBy: userId });
      await tx.insert(workspaceMembers).values({ workspaceId: wsId, userId, role: 'owner' });
      await tx.insert(channels).values({
        id: chanId,
        workspaceId: wsId,
        name: 'general',
        topic: 'This is the beginning of the workspace.',
        createdBy: userId,
      });
      await tx.insert(channelMembers).values({ channelId: chanId, userId });
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw conflict('slug_taken', 'workspace slug already in use');
    throw err;
  }
  const created = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  publishWorkspaceJoined(wsId, userId);
  return toWorkspaceDTO(created[0]!, 'owner');
}

export async function getWorkspace(workspaceId: string, userId: string): Promise<WorkspaceDTO> {
  const m = await requireMembership(workspaceId, userId);
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!rows[0]) throw notFound('workspace not found');
  return toWorkspaceDTO(rows[0], m.role);
}

export async function myWorkspaces(userId: string): Promise<WorkspaceDTO[]> {
  const rows = await db
    .select({ w: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.joinedAt);
  return rows.map((r) => toWorkspaceDTO(r.w, r.role));
}

export async function listMembers(workspaceId: string, userId: string): Promise<WorkspaceMemberDTO[]> {
  await requireMembership(workspaceId, userId);
  const rows = await db
    .select({ m: workspaceMembers, u: users })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.joinedAt);
  return rows.map((r) => ({
    userId: r.u.id,
    displayName: r.u.displayName,
    email: r.u.email,
    avatarUrl: r.u.avatarUrl,
    role: r.m.role,
    joinedAt: r.m.joinedAt.toISOString(),
  }));
}

/** Owner/admin only (spec permission rules). Returns invite URL with raw token (shown once). */
export async function createInvite(workspaceId: string, inviterId: string, email: string): Promise<InviteDTO> {
  const m = await requireMembership(workspaceId, inviterId);
  if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('only owners and admins can invite');

  const already = await db
    .select({ one: sql`1` })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)))
    .limit(1);
  if (already.length > 0) throw conflict('already_member', 'user is already a member of this workspace');

  const token = newToken();
  const id = newId();
  const expiresAt = new Date(Date.now() + config.inviteTtlDays * 86400_000);
  // one pending invite per email: replace any prior (possibly expired) invite
  await db.delete(invites).where(and(eq(invites.workspaceId, workspaceId), eq(invites.email, email), isNull(invites.acceptedAt)));
  try {
    await db.insert(invites).values({
      id,
      workspaceId,
      email,
      tokenHash: hashToken(token),
      invitedBy: inviterId,
      expiresAt,
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw conflict('invite_exists', 'an invite for this email already exists');
    throw err;
  }
  return {
    id,
    workspaceId,
    email,
    inviteUrl: `${config.inviteUrlBase}${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Accept invite by raw token → join workspace + auto-join #general. */
export async function acceptInvite(userId: string, token: string): Promise<WorkspaceDTO> {
  const tokenHash = hashToken(token);
  const rows = await db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1);
  const inv = rows[0];
  if (!inv) throw notFound('invite not found');
  if (inv.acceptedAt) throw conflict('invite_used', 'invite already accepted');
  if (inv.expiresAt < new Date()) throw badRequest('invite_expired', 'invite has expired');

  await db.transaction(async (tx) => {
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId })
      .onConflictDoNothing();
    const general = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, inv.workspaceId), eq(channels.name, 'general')))
      .limit(1);
    if (general[0]) {
      await tx.insert(channelMembers).values({ channelId: general[0].id, userId }).onConflictDoNothing();
    }
  });

  const u = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  publishEvent(subjectMeta(inv.workspaceId), {
    type: 'member.joined',
    workspaceId: inv.workspaceId,
    ts: new Date().toISOString(),
    data: {
      userId,
      displayName: u[0]?.displayName ?? '',
      email: u[0]?.email ?? '',
      avatarUrl: u[0]?.avatarUrl ?? null,
      role: 'member',
      joinedAt: new Date().toISOString(),
    },
  });

  const ws = await db.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId)).limit(1);
  publishWorkspaceJoined(inv.workspaceId, userId);
  return toWorkspaceDTO(ws[0]!, 'member');
}

/** Tell the joining user's live sockets so the gateway can subscribe them (they authed before joining). */
function publishWorkspaceJoined(workspaceId: string, userId: string): void {
  publishEvent(subjectUserMeta(userId), {
    type: 'workspace.joined',
    workspaceId,
    ts: new Date().toISOString(),
    data: { userId },
  });
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
    || (typeof err === 'object' && err !== null && 'cause' in err && isUniqueViolation((err as { cause?: unknown }).cause));
}
