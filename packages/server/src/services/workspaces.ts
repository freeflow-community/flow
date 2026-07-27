import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  SIDEBAR_COLOR_IDS,
  emailDomain,
  isSelfRegisterableDomain,
  type InviteDTO,
  type JoinLinkDTO,
  type JoinLinkPreviewDTO,
  type MemberRole,
  type WorkspaceDTO,
  type WorkspaceMemberDTO,
} from '@flow/shared';
import { db, schema, type Tx } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newLinkToken, newToken } from '../lib/tokens.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { publishEvent, subjectMeta, subjectUserMeta } from '../bus.js';
import { emailSender } from '../email/index.js';
import { killAgentCredentials, removeMemberDeep, removeSponsoredAgents } from './memberRemoval.js';

const {
  workspaces,
  workspaceMembers,
  workspaceJoinLinks,
  invites,
  channels,
  channelMembers,
  users,
  sessions,
  emailTokens,
  appLinkCodes,
  oauthIdentities,
} = schema;

export function toWorkspaceDTO(w: typeof workspaces.$inferSelect, role?: MemberRole): WorkspaceDTO {
  const dto: WorkspaceDTO = {
    id: w.id,
    slug: w.slug,
    name: w.name,
    sidebarColor: w.sidebarColor,
    googleSelfRegisterDomain: w.googleSelfRegisterDomain,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
  };
  if (role) dto.role = role;
  return dto;
}

/**
 * Guard for the Google domain self-register toggle (phase16 §5a/§7).
 *
 * Trust anchor: the setter's *own* verified Google email domain. We do not
 * prove they control the DNS domain — enabling `acme.com` requires holding a
 * Google account Google says is verified on `acme.com`. On top of that:
 * consumer domains are denied outright, and (unless FLOW_GOOGLE_REQUIRE_HD=0)
 * the account must be a Google Workspace account on that domain, so a personal
 * Gmail that merely spells a corporate address can't open the doors.
 */
async function assertMaySelfRegisterDomain(userId: string, domain: string): Promise<void> {
  if (!isSelfRegisterableDomain(domain)) {
    throw badRequest('domain_not_allowed', `${domain} cannot be opened to self-registration`);
  }
  const rows = await db
    .select()
    .from(oauthIdentities)
    .where(and(eq(oauthIdentities.userId, userId), eq(oauthIdentities.provider, 'google')));
  const match = rows.find((r) => emailDomain(r.email) === domain);
  if (!match) {
    throw forbidden(`you can only open a workspace to your own Google email domain`);
  }
  if (config.googleRequireHostedDomain && (match.hostedDomain ?? '').toLowerCase() !== domain) {
    throw forbidden(`${domain} must be a Google Workspace domain on your account`);
  }
}

/**
 * Workspace branding (phase 3.5 ruling 3): owner/admin sets the sidebar color
 * (curated preset id) for everyone; broadcast on meta so clients restyle live.
 */
export async function updateWorkspace(
  workspaceId: string,
  actorId: string,
  patch: {
    sidebarColor?: string | undefined;
    // phase 11 §10 — null allowlist clears it back to "all domains allowed"
    unfurlEnabled?: boolean | undefined;
    unfurlDomainAllowlist?: string[] | null | undefined;
    // phase 16 §5a — null turns domain self-registration off
    googleSelfRegisterDomain?: string | null | undefined;
  },
): Promise<WorkspaceDTO> {
  const m = await requireMembership(workspaceId, actorId);
  if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('only owners and admins can change workspace settings');
  const set: Partial<{
    sidebarColor: string;
    unfurlEnabled: boolean;
    unfurlDomainAllowlist: string[] | null;
    googleSelfRegisterDomain: string | null;
  }> = {};
  if (patch.sidebarColor !== undefined) {
    if (!SIDEBAR_COLOR_IDS.includes(patch.sidebarColor)) {
      throw badRequest('bad_color', `sidebarColor must be one of: ${SIDEBAR_COLOR_IDS.join(', ')}`);
    }
    set.sidebarColor = patch.sidebarColor;
  }
  if (patch.unfurlEnabled !== undefined) set.unfurlEnabled = patch.unfurlEnabled;
  if (patch.unfurlDomainAllowlist !== undefined) {
    set.unfurlDomainAllowlist = patch.unfurlDomainAllowlist === null
      ? null
      : patch.unfurlDomainAllowlist.map((d) => d.trim().toLowerCase()).filter(Boolean);
  }
  if (patch.googleSelfRegisterDomain !== undefined) {
    if (patch.googleSelfRegisterDomain === null) {
      set.googleSelfRegisterDomain = null;
    } else {
      const domain = patch.googleSelfRegisterDomain.trim().toLowerCase();
      await assertMaySelfRegisterDomain(actorId, domain);
      set.googleSelfRegisterDomain = domain;
    }
  }
  const updated = await db
    .update(workspaces)
    .set(set)
    .where(eq(workspaces.id, workspaceId))
    .returning();
  if (!updated[0]) throw notFound('workspace not found');
  const dto = toWorkspaceDTO(updated[0]);
  publishEvent(subjectMeta(workspaceId), {
    type: 'workspace.updated',
    workspaceId,
    ts: new Date().toISOString(),
    data: dto,
  });
  return toWorkspaceDTO(updated[0], m.role);
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

/** Create workspace: creator becomes owner, #general auto-created (spec §4).
 * `googleSelfRegisterDomain` (phase16 §5a) is offered at creation only to a
 * creator who signed in with Google, and validated the same way as the later
 * PATCH — the client never gets to name a domain that isn't its own. */
export async function createWorkspace(
  userId: string,
  name: string,
  slug: string,
  googleSelfRegisterDomain?: string | null,
): Promise<WorkspaceDTO> {
  // Role guard (AGENTS_DESIGN.md): agents are always plain members — creating
  // a workspace is the only path to owner/admin, so it is closed to them.
  const creator = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (creator[0]?.isAgent) throw forbidden('agents cannot create workspaces');
  const domain = googleSelfRegisterDomain ? googleSelfRegisterDomain.trim().toLowerCase() : null;
  if (domain) await assertMaySelfRegisterDomain(userId, domain);
  const wsId = newId();
  const chanId = newId();
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(workspaces)
        .values({ id: wsId, slug, name, createdBy: userId, googleSelfRegisterDomain: domain });
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
    statusEmoji: r.u.statusEmoji,
    statusText: r.u.statusText,
    isAgent: r.u.isAgent,
    sponsorId: r.u.isAgent ? r.u.sponsorUserId : null,
    role: r.m.role,
    joinedAt: r.m.joinedAt.toISOString(),
  }));
}

async function toMemberDTO(workspaceId: string, userId: string): Promise<WorkspaceMemberDTO> {
  const rows = await db
    .select({ m: workspaceMembers, u: users })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  const r = rows[0];
  if (!r) throw notFound('member not found');
  return {
    userId: r.u.id,
    displayName: r.u.displayName,
    email: r.u.email,
    avatarUrl: r.u.avatarUrl,
    statusEmoji: r.u.statusEmoji,
    statusText: r.u.statusText,
    isAgent: r.u.isAgent,
    sponsorId: r.u.isAgent ? r.u.sponsorUserId : null,
    role: r.m.role,
    joinedAt: r.m.joinedAt.toISOString(),
  };
}

/**
 * Admin panel: change a member's workspace role. Owner/admin only; the owner
 * role is immutable and can't be assigned here, and you can't change your own
 * role (no accidental self-lockout). Broadcasts member.updated on meta so every
 * client refreshes the roster — and the target's own client re-derives its role
 * (menu gating) from the refreshed workspace list.
 */
export async function setMemberRole(
  workspaceId: string,
  actorId: string,
  targetId: string,
  role: Exclude<MemberRole, 'owner'>,
): Promise<WorkspaceMemberDTO> {
  const actor = await requireMembership(workspaceId, actorId);
  if (actor.role !== 'owner' && actor.role !== 'admin') throw forbidden('only owners and admins can manage members');
  if (targetId === actorId) throw badRequest('self_role', 'you cannot change your own role');
  const target = await requireMembership(workspaceId, targetId);
  if (target.role === 'owner') throw forbidden('the workspace owner role cannot be changed');
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)));
  const dto = await toMemberDTO(workspaceId, targetId);
  publishEvent(subjectMeta(workspaceId), {
    type: 'member.updated',
    workspaceId,
    ts: new Date().toISOString(),
    data: dto,
  });
  return dto;
}

/**
 * Admin panel: remove a member from the workspace (and every channel there).
 * Owner/admin only; the owner can't be removed and you can't remove yourself.
 * Reuses removeMemberDeep, which publishes the member.left cascade.
 *
 * Last-workspace rule (decision_log 2026-07-21): if this was the member's only
 * workspace, the human user is tombstoned in the SAME transaction — deleted_at
 * set and the unique email vacated so the address is free to register again.
 * The row is kept so their past messages keep their author name. Bots/agents
 * are never tombstoned here — they have their own deleteApp / removeAgent
 * lifecycles, and dropping their user row would orphan apps/agent_tokens.
 */
export async function removeMember(workspaceId: string, actorId: string, targetId: string): Promise<void> {
  const actor = await requireMembership(workspaceId, actorId);
  if (actor.role !== 'owner' && actor.role !== 'admin') throw forbidden('only owners and admins can remove members');
  if (targetId === actorId) throw badRequest('self_remove', 'you cannot remove yourself');
  const target = await requireMembership(workspaceId, targetId);
  if (target.role === 'owner') throw forbidden('the workspace owner cannot be removed');
  const [u] = await db
    .select({ isBot: users.isBot, isAgent: users.isAgent, email: users.email })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  const tombstoneEligible = !!u && !u.isBot && !u.isAgent;
  // Sponsor-departure cascade (AGENT_MEMBERS.md): their agents go with them.
  if (tombstoneEligible) await removeSponsoredAgents(workspaceId, targetId);
  // Removing an agent here (admin panel) must mean the same as the Agents
  // modal: revoke tokens + kill username/key, or the daemon lingers as an
  // authenticated zombie with no memberships.
  if (u?.isAgent) await killAgentCredentials(targetId);
  await removeMemberDeep(workspaceId, targetId, async (tx) => {
    // removeMemberDeep has already deleted the target's row for THIS workspace
    // before `also` runs, so any remaining row means they're still elsewhere.
    if (!tombstoneEligible) return;
    const stillMember = await tx
      .select({ one: sql`1` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, targetId))
      .limit(1);
    if (stillMember.length > 0) return;
    await tombstoneUser(tx, targetId, u.email);
  });
}

/**
 * Mark a user dead and free their address. Keeps the row (message authorship)
 * but rewrites the unique `email` so the original string is available to a
 * fresh registration, scrubs the password to an unusable sentinel, and drops
 * every credential (sessions, email tokens, app-link codes) so nothing that
 * account held can still authenticate. The mangled email preserves the original
 * for audit and can never collide (the user id prefix is unique).
 */
async function tombstoneUser(tx: Tx, userId: string, email: string): Promise<void> {
  await tx
    .update(users)
    .set({ deletedAt: new Date(), email: `tombstone+${userId}+${email}`, passwordHash: `!deleted:${userId}` })
    .where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(emailTokens).where(eq(emailTokens.userId, userId));
  await tx.delete(appLinkCodes).where(eq(appLinkCodes.userId, userId));
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

  // Invite email (operator request 2026-07-20). The emailed link is always the
  // web accept URL — the web app walks through register-then-accept — while
  // inviteUrl keeps the configured base (deep link on default local config).
  // A failed send never fails the invite: the admin still gets the link.
  let emailSent = false;
  try {
    const inviter = (await db.select().from(users).where(eq(users.id, inviterId)).limit(1))[0];
    const wsRow = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
    await emailSender().send({
      to: email,
      subject: `${inviter?.displayName ?? 'Someone'} invited you to ${wsRow?.name ?? 'a workspace'} on Flow`,
      text:
        `${inviter?.displayName ?? 'Someone'} invited you to join the "${wsRow?.name ?? ''}" workspace on Flow.\n\n` +
        `Accept the invite here:\n\n` +
        `${config.webUrlBase}/invite/${token}\n\n` +
        `If you don't have a Flow account yet, you'll create one first and the ` +
        `invite is applied automatically. This link expires in ${config.inviteTtlDays} days ` +
        `and can only be used once.\n`,
    });
    emailSent = true;
  } catch (err) {
    console.error(`invite email failed for ${email}: ${(err as Error).message}`);
  }

  return {
    id,
    workspaceId,
    email,
    inviteUrl: `${config.inviteUrlBase}${token}`,
    expiresAt: expiresAt.toISOString(),
    emailSent,
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
    await enrollInWorkspace(tx, inv.workspaceId, userId);
  });

  await announceJoin(inv.workspaceId, userId);
  const ws = await db.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId)).limit(1);
  return toWorkspaceDTO(ws[0]!, 'member');
}

// ---- Persistent workspace join links (issue #85) --------------------------
//
// The emailed invite above is one-address, one-use. This is the other half of
// the job Slack splits the same way: a link an admin drops in a doc or a group
// chat and leaves there. Exactly one is live per workspace — generating a new
// one revokes the old — and unlike invites it never expires on its own.

/** Owner/admin gate, shared by every join-link operation (same rule as invites). */
async function requireInviteRights(workspaceId: string, userId: string): Promise<void> {
  const m = await requireMembership(workspaceId, userId);
  if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('only owners and admins can invite');
}

/** The shareable URL: the slug is in there so the link reads as the workspace
 * it joins, not an opaque blob (issue #85). */
function joinUrl(slug: string, token: string): string {
  return `${config.webUrlBase}/join/${slug}/${token}`;
}

async function joinLinkRow(workspaceId: string) {
  return (await db.select().from(workspaceJoinLinks).where(eq(workspaceJoinLinks.workspaceId, workspaceId)).limit(1))[0];
}

/** Owner/admin only. The live link, or `joinUrl: null` when there isn't one. */
export async function getJoinLink(workspaceId: string, userId: string): Promise<JoinLinkDTO> {
  await requireInviteRights(workspaceId, userId);
  const row = await joinLinkRow(workspaceId);
  if (!row) return { workspaceId, joinUrl: null };
  const ws = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]!;
  return {
    workspaceId,
    joinUrl: joinUrl(ws.slug, row.token),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Owner/admin only. Mint the workspace's join link, replacing any existing one
 * — "one at a time" is the point, so regenerating IS the way to revoke a link
 * that leaked while keeping the door open.
 */
export async function createJoinLink(workspaceId: string, userId: string): Promise<JoinLinkDTO> {
  await requireInviteRights(workspaceId, userId);
  const ws = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
  if (!ws) throw notFound('workspace not found');
  // Deliberately shorter than the house 32-byte token: this one is read by
  // people, not just machines. See newLinkToken.
  const token = newLinkToken();
  const row = (
    await db
      .insert(workspaceJoinLinks)
      .values({ workspaceId, token, createdBy: userId })
      .onConflictDoUpdate({
        target: workspaceJoinLinks.workspaceId,
        set: { token, createdBy: userId, createdAt: new Date() },
      })
      .returning()
  )[0]!;
  return {
    workspaceId,
    joinUrl: joinUrl(ws.slug, token),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Owner/admin only. Kills the link outright — the URL 404s from here on.
 * Idempotent: revoking when there is no link is a no-op, not an error. */
export async function revokeJoinLink(workspaceId: string, userId: string): Promise<JoinLinkDTO> {
  await requireInviteRights(workspaceId, userId);
  await db.delete(workspaceJoinLinks).where(eq(workspaceJoinLinks.workspaceId, workspaceId));
  return { workspaceId, joinUrl: null };
}

/**
 * Unauthenticated: name the workspace behind a join link so the landing page
 * can say "Join Acme" before the visitor has an account. Holding the token is
 * the authorization — it already grants membership.
 */
export async function previewJoinLink(token: string): Promise<JoinLinkPreviewDTO> {
  const row = (await db.select().from(workspaceJoinLinks).where(eq(workspaceJoinLinks.token, token)).limit(1))[0];
  if (!row) throw notFound('this join link is no longer valid');
  const ws = (await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
  if (!ws) throw notFound('this join link is no longer valid');
  return { workspaceId: ws.id, slug: ws.slug, name: ws.name };
}

/**
 * Redeem a join link → join the workspace (+ #general), same enrollment path
 * as an invite accept. Idempotent for someone who is already a member: they
 * just land in the workspace, and nobody gets a second "joined" message.
 */
export async function redeemJoinLink(userId: string, token: string): Promise<WorkspaceDTO> {
  const row = (await db.select().from(workspaceJoinLinks).where(eq(workspaceJoinLinks.token, token)).limit(1))[0];
  if (!row) throw notFound('this join link is no longer valid');
  const ws = (await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
  if (!ws) throw notFound('this join link is no longer valid');

  const joined = await db.transaction(async (tx) => enrollInWorkspace(tx, ws.id, userId));
  if (joined) await announceJoin(ws.id, userId);

  const m = (
    await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
      .limit(1)
  )[0];
  return toWorkspaceDTO(ws, m?.role ?? 'member');
}

/**
 * The join primitive shared by every path into a workspace that isn't
 * "create it" (invite accept, phase16 domain self-registration): the member row
 * plus #general membership, inside the caller's transaction. Returns false when
 * the user was already a member, so callers can skip announcing a no-op join.
 */
export async function enrollInWorkspace(
  tx: Tx,
  workspaceId: string,
  userId: string,
  role: MemberRole = 'member',
): Promise<boolean> {
  const inserted = await tx
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .onConflictDoNothing()
    .returning({ userId: workspaceMembers.userId });
  const general = await tx
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')))
    .limit(1);
  if (general[0]) {
    await tx.insert(channelMembers).values({ channelId: general[0].id, userId }).onConflictDoNothing();
  }
  return inserted.length > 0;
}

/** Broadcast a completed join: the roster event for everyone, plus the
 * per-user nudge that lets the joiner's live sockets subscribe. */
export async function announceJoin(workspaceId: string, userId: string, role: MemberRole = 'member'): Promise<void> {
  const u = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  publishEvent(subjectMeta(workspaceId), {
    type: 'member.joined',
    workspaceId,
    ts: new Date().toISOString(),
    data: {
      userId,
      displayName: u[0]?.displayName ?? '',
      email: u[0]?.email ?? '',
      avatarUrl: u[0]?.avatarUrl ?? null,
      isAgent: u[0]?.isAgent ?? false,
      role,
      joinedAt: new Date().toISOString(),
    },
  });
  publishWorkspaceJoined(workspaceId, userId);
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
