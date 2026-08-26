// First-class AI agents (AGENT_MEMBERS.md): invite-code onboarding.
//
// Agents are real `users` rows (is_agent=true) and ordinary workspace members
// (always role 'member'), so channels, DMs, threads, reactions, files, typing,
// and presence work with zero special cases. Onboarding: a human member
// generates a one-time invite code inside Flow; the agent redeems it
// (`npx flow-agent-bridge <code>`), bringing its durable credentials (username +
// secret key), and joins immediately — no approval popup. The code carries the
// sponsor + workspace; the sponsor is recorded on the agent's user row and is
// responsible for what the agent does. The avatar is picked at random and the
// sponsor can change it in-app afterwards.
import { randomBytes, randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AgentInviteDTO, AgentLoginResponse, AgentRedeemResponse, RedeemAgentInviteBody } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { publishEvent, subjectMeta } from '../bus.js';
import { postSystemMessage } from './messages.js';
import { requireMembership, toWorkspaceDTO } from './workspaces.js';
import { killAgentCredentials, removeMemberDeep } from './memberRemoval.js';
import { hashSecret, toUserDTO, verifySecret } from './auth.js';
import { setAvatar } from './users.js';
import { listAgentAvatarPresets, readAgentAvatarPreset } from './agentAvatars.js';

const { agentInvites, agentTokens, channels, channelMembers, users, workspaceMembers, workspaces } = schema;

const INVITE_TTL_MS = config.inviteTtlDays * 86400_000;

// Invite codes are meant to be read aloud / retyped, so we keep them short and
// unambiguous: `flow-` + two groups of 4 over an uppercase alphabet with no
// 0/O/1/I confusables (~40 bits). Guessability is bounded instead by the
// single-use + 7-day-expiry + rate-limited redeem endpoint.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newInviteCode(): string {
  const group = (): string =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!).join('');
  return `flow-${group()}-${group()}`;
}

/** A random preset avatar id (or null if none are bundled). */
function pickRandomAvatarPreset(): string | null {
  const ids = listAgentAvatarPresets();
  return ids.length > 0 ? ids[randomInt(ids.length)]! : null;
}

/**
 * Generate a one-time invite code for the sponsor's workspace (any member can
 * sponsor — operator ruling; a permission knob can come later). The raw code is
 * returned once; only its hash is stored.
 */
export async function createAgentInvite(workspaceId: string, sponsorId: string): Promise<AgentInviteDTO> {
  await requireMembership(workspaceId, sponsorId);
  const code = newInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(agentInvites).values({
    id: newId(),
    codeHash: hashToken(code),
    workspaceId,
    sponsorUserId: sponsorId,
    expiresAt,
  });
  return { code, command: `npx flow-agent-bridge ${code}`, expiresAt: expiresAt.toISOString() };
}

/**
 * Redeem a one-time invite code (unauthenticated — the code IS the auth). Creates
 * the agent's user account (credentials from the request; sponsor + workspace
 * from the invite), assigns a random preset avatar, joins the workspace +
 * #general, and mints the agent token — all synchronously. No sponsor approval.
 */
export async function redeemAgentInvite(input: RedeemAgentInviteBody): Promise<AgentRedeemResponse> {
  const username = input.username.toLowerCase();
  const invite = (
    await db.select().from(agentInvites).where(eq(agentInvites.codeHash, hashToken(input.code))).limit(1)
  )[0];
  if (!invite) throw notFound('invite not found');
  if (invite.redeemedAt) throw badRequest('invite_used', 'this invite code has already been used');
  if (invite.expiresAt < new Date()) {
    throw badRequest('invite_expired', 'this invite code has expired — generate a new one in Flow');
  }
  const taken = await db.select({ one: sql`1` }).from(users).where(eq(users.agentUsername, username)).limit(1);
  if (taken.length > 0) throw badRequest('username_taken', 'that agent username is already registered');

  const userId = newId();
  const keyHash = await hashSecret(input.key); // argon2 — do the heavy work before the transaction
  const agentToken = `flow-agent-token-${newToken()}`;
  let generalChannel: { id: string; workspaceId: string; kind: string } | null = null;
  await db.transaction(async (tx) => {
    // claim the invite first (conditional update guards double-redeem races);
    // agentUserId is stamped after the user row exists (FK)
    const claimed = await tx
      .update(agentInvites)
      .set({ redeemedAt: new Date() })
      .where(and(eq(agentInvites.id, invite.id), isNull(agentInvites.redeemedAt)))
      .returning();
    if (!claimed[0]) throw badRequest('invite_used', 'this invite code has already been used');
    const takenTx = await tx.select({ one: sql`1` }).from(users).where(eq(users.agentUsername, username)).limit(1);
    if (takenTx.length > 0) throw badRequest('username_taken', 'that agent username is already registered');
    // Same recipe as app bot users: synthetic unique email, unusable password
    // hash, emailVerifiedAt stamped (agents never do the email flow).
    await tx.insert(users).values({
      id: userId,
      email: `agent-${userId}@agents.flow.local`,
      passwordHash: `!agent:${randomBytes(24).toString('hex')}`,
      displayName: input.name.trim(),
      statusText: input.description?.slice(0, 80) ?? '',
      isAgent: true,
      emailVerifiedAt: new Date(),
      sponsorUserId: invite.sponsorUserId,
      agentUsername: username,
      agentKeyHash: keyHash,
    });
    await tx.update(agentInvites).set({ agentUserId: userId }).where(eq(agentInvites.id, invite.id));
    await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: 'member' });
    const general = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, invite.workspaceId), eq(channels.name, 'general')))
      .limit(1);
    if (general[0]) {
      await tx.insert(channelMembers).values({ channelId: general[0].id, userId }).onConflictDoNothing();
      generalChannel = { id: general[0].id, workspaceId: invite.workspaceId, kind: general[0].kind };
    }
    await tx.insert(agentTokens).values({ id: newId(), tokenHash: hashToken(agentToken), userId });
  });
  // Random preset avatar through the normal pipeline (square-crop → webp → R2)
  // BEFORE announcing the join, so member.joined already carries the avatarUrl.
  // Best-effort: a failure here shouldn't undo a successful join.
  const preset = pickRandomAvatarPreset();
  if (preset) {
    try {
      await setAvatar(userId, readAgentAvatarPreset(preset), 'image/png');
    } catch (err) {
      console.error(`agent avatar assignment failed for ${userId}: ${(err as Error).message}`);
    }
  }
  const userRow = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
  const wsRow = (await db.select().from(workspaces).where(eq(workspaces.id, invite.workspaceId)).limit(1))[0]!;
  publishEvent(subjectMeta(invite.workspaceId), {
    type: 'member.joined',
    workspaceId: invite.workspaceId,
    ts: new Date().toISOString(),
    data: {
      userId,
      displayName: userRow.displayName,
      email: userRow.email,
      avatarUrl: userRow.avatarUrl,
      statusEmoji: userRow.statusEmoji,
      statusText: userRow.statusText,
      isAgent: true,
      sponsorId: invite.sponsorUserId,
      role: 'member',
      joinedAt: new Date().toISOString(),
    },
  });
  // Announce the agent's arrival in #general with the same inline notice a human
  // join posts (ui_nits). Best-effort inside postSystemMessage.
  if (generalChannel) await postSystemMessage(generalChannel, userId, 'member_joined');
  return {
    agentToken,
    user: toUserDTO(userRow),
    workspace: toWorkspaceDTO(wsRow),
  };
}

/**
 * Username + key → fresh agent token (the "lost agent.json" path — no admin
 * involved). Revokes every prior token, so login doubles as rotation.
 */
export async function agentLogin(username: string, key: string): Promise<AgentLoginResponse> {
  const user = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.agentUsername, username.toLowerCase()), eq(users.isAgent, true)))
      .limit(1)
  )[0];
  const ok = user?.agentKeyHash ? await verifySecret(user.agentKeyHash, key) : false;
  if (!user || !ok) throw unauthorized('invalid agent credentials');
  const agentToken = `flow-agent-token-${newToken()}`;
  await db.transaction(async (tx) => {
    await tx
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentTokens.userId, user.id), isNull(agentTokens.revokedAt)));
    await tx.insert(agentTokens).values({ id: newId(), tokenHash: hashToken(agentToken), userId: user.id });
  });
  return { agentToken, user: toUserDTO(user) };
}

/**
 * Remove an agent (owner/admin, or the agent's sponsor) — same semantics as
 * app removal: leave the workspace + channels, delete 1:1 DMs, revoke every
 * token AND the username/key credentials, keep the user row for authorship.
 * Registering again mints a fresh identity.
 */
export async function removeAgent(workspaceId: string, agentUserId: string, actorId: string): Promise<void> {
  const actor = await requireMembership(workspaceId, actorId);
  const target = (await db.select().from(users).where(eq(users.id, agentUserId)).limit(1))[0];
  if (!target?.isAgent) throw notFound('agent not found');
  const membership = await db
    .select({ one: sql`1` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentUserId)))
    .limit(1);
  if (membership.length === 0) throw notFound('agent not found');
  if (actor.role !== 'owner' && actor.role !== 'admin' && target.sponsorUserId !== actorId) {
    throw forbidden('only owners, admins, or the agent’s sponsor can remove an agent');
  }
  await killAgentCredentials(agentUserId);
  await removeMemberDeep(workspaceId, agentUserId);
}
