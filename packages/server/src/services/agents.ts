// First-class AI agents (AGENT_MEMBERS.md): on-demand registration with human
// sponsors.
//
// Agents are real `users` rows (is_agent=true) and ordinary workspace members
// (always role 'member'), so channels, DMs, threads, reactions, files, typing,
// and presence work with zero special cases. Registration mirrors human
// signup: the agent brings durable credentials (username + secret key) and
// names a sponsor by email; the sponsor approves a matching pairing code
// inside Flow. No admin invites, no pre-registration. The sponsor is recorded
// on the agent's user row and is responsible for what the agent does.
import { randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type {
  AgentLoginResponse,
  AgentPairingRequestDTO,
  AgentRegisterPollResponse,
  AgentRegisterStartResponse,
  RegisterAgentBody,
} from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken, tokensEqual } from '../lib/tokens.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { publishEvent, subjectMeta, subjectUserNotify } from '../bus.js';
import { requireMembership } from './workspaces.js';
import { killAgentCredentials, removeMemberDeep } from './memberRemoval.js';
import { hashSecret, toUserDTO, verifySecret } from './auth.js';

const { agentPairingRequests, agentTokens, channels, channelMembers, users, workspaceMembers, workspaces } = schema;

const PAIRING_TTL_MS = 10 * 60_000;

// Pairing codes are read aloud / eyeballed across two screens: short, grouped,
// and drawn from an alphabet without 0/O/1/I/L confusables.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newPairingCode(): string {
  const pick = (): string => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!;
  return `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
}

type PairingRow = typeof agentPairingRequests.$inferSelect;

function toPairingDTO(r: PairingRow): AgentPairingRequestDTO {
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    description: r.description,
    code: r.code,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  };
}

/**
 * Open a pairing request (unauthenticated). Creates nothing but the pending
 * row; the sponsor's live sockets get an `agent.pairing` prompt. The response
 * is identical whether or not sponsorEmail matched an account — a miss just
 * expires unapproved (no account enumeration).
 */
export async function startAgentRegistration(input: RegisterAgentBody): Promise<AgentRegisterStartResponse> {
  const username = input.username.toLowerCase();
  const taken = await db.select({ one: sql`1` }).from(users).where(eq(users.agentUsername, username)).limit(1);
  if (taken.length > 0) throw badRequest('username_taken', 'that agent username is already registered');
  // opportunistic cleanup: expired pending requests are dead weight
  await db
    .delete(agentPairingRequests)
    .where(and(lt(agentPairingRequests.expiresAt, sql`now()`), eq(agentPairingRequests.status, 'pending')));
  const sponsor = (
    await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, input.sponsorEmail),
          isNull(users.deletedAt),
          eq(users.isAgent, false),
          eq(users.isBot, false),
        ),
      )
      .limit(1)
  )[0];
  const id = newId();
  const pollSecret = newToken();
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.insert(agentPairingRequests).values({
    id,
    username,
    keyHash: await hashSecret(input.key),
    name: input.name.trim(),
    description: input.description ?? null,
    avatarUrl: input.avatarUrl ?? null,
    sponsorUserId: sponsor?.id ?? null,
    code,
    pollSecretHash: hashToken(pollSecret),
    expiresAt,
  });
  if (sponsor) {
    const row = (await db.select().from(agentPairingRequests).where(eq(agentPairingRequests.id, id)).limit(1))[0]!;
    publishEvent(subjectUserNotify(sponsor.id), {
      type: 'agent.pairing',
      workspaceId: '', // no workspace yet — the sponsor picks one at approval
      ts: new Date().toISOString(),
      data: toPairingDTO(row),
    });
  }
  return { requestId: id, pollSecret, code, expiresAt: expiresAt.toISOString() };
}

/**
 * The agent's poll (authenticated by the pollSecret). On the first poll after
 * approval the agent token is minted and delivered — exactly once; if that
 * response is lost, username+key login is the recovery path.
 */
export async function pollAgentRegistration(requestId: string, pollSecret: string): Promise<AgentRegisterPollResponse> {
  const row = (await db.select().from(agentPairingRequests).where(eq(agentPairingRequests.id, requestId)).limit(1))[0];
  if (!row || !pollSecret || !tokensEqual(row.pollSecretHash, hashToken(pollSecret))) {
    throw unauthorized('unknown pairing request');
  }
  if (row.status === 'denied') return { status: 'denied' };
  if (row.status === 'pending') {
    return row.expiresAt < new Date() ? { status: 'expired' } : { status: 'pending' };
  }
  // approved — deliver the token exactly once (conditional update wins races)
  if (!row.agentUserId || !row.workspaceId) return { status: 'approved' };
  const claimed = await db
    .update(agentPairingRequests)
    .set({ tokenDeliveredAt: new Date() })
    .where(and(eq(agentPairingRequests.id, requestId), isNull(agentPairingRequests.tokenDeliveredAt)))
    .returning();
  if (!claimed[0]) return { status: 'approved' };
  const agentToken = `flow-agent-token-${newToken()}`;
  await db.insert(agentTokens).values({ id: newId(), tokenHash: hashToken(agentToken), userId: row.agentUserId });
  const userRow = (await db.select().from(users).where(eq(users.id, row.agentUserId)).limit(1))[0]!;
  const wsRow = (await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0]!;
  return {
    status: 'approved',
    agentToken,
    user: toUserDTO(userRow),
    workspace: {
      id: wsRow.id,
      slug: wsRow.slug,
      name: wsRow.name,
      sidebarColor: wsRow.sidebarColor,
      createdBy: wsRow.createdBy,
      createdAt: wsRow.createdAt.toISOString(),
    },
  };
}

/** The sponsor's pending pairing requests (GET /v1/me/agent-requests). */
export async function listPairingRequests(sponsorId: string): Promise<AgentPairingRequestDTO[]> {
  const rows = await db
    .select()
    .from(agentPairingRequests)
    .where(
      and(
        eq(agentPairingRequests.sponsorUserId, sponsorId),
        eq(agentPairingRequests.status, 'pending'),
        gt(agentPairingRequests.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(agentPairingRequests.createdAt));
  return rows.map(toPairingDTO);
}

/**
 * Sponsor approval: creates the agent's user account (credentials + sponsor
 * from the pairing row), joins the chosen workspace + #general. Any member can
 * sponsor (operator ruling — a permission knob can come later). The token is
 * NOT minted here; the agent's next poll delivers it.
 */
export async function approveAgentRequest(requestId: string, actorId: string, workspaceId: string): Promise<void> {
  await requireMembership(workspaceId, actorId);
  const row = (await db.select().from(agentPairingRequests).where(eq(agentPairingRequests.id, requestId)).limit(1))[0];
  // sponsor mismatch reads as not-found: other users' requests are invisible
  if (!row || row.sponsorUserId !== actorId) throw notFound('pairing request not found');
  if (row.status !== 'pending') throw badRequest('not_pending', 'this pairing request is already resolved');
  if (row.expiresAt < new Date()) throw badRequest('expired', 'this pairing request has expired — re-run register');
  const userId = newId();
  await db.transaction(async (tx) => {
    // claim first (conditional update guards double-approve races); the agent
    // user row doesn't exist yet, so agentUserId is stamped after the insert
    const claimed = await tx
      .update(agentPairingRequests)
      .set({ status: 'approved', workspaceId })
      .where(and(eq(agentPairingRequests.id, requestId), eq(agentPairingRequests.status, 'pending')))
      .returning();
    if (!claimed[0]) throw badRequest('not_pending', 'this pairing request is already resolved');
    const taken = await tx.select({ one: sql`1` }).from(users).where(eq(users.agentUsername, row.username)).limit(1);
    if (taken.length > 0) throw badRequest('username_taken', 'that agent username is already registered');
    // Same recipe as app bot users: synthetic unique email, unusable password
    // hash, emailVerifiedAt stamped (agents never do the email flow).
    await tx.insert(users).values({
      id: userId,
      email: `agent-${userId}@agents.flow.local`,
      passwordHash: `!agent:${randomBytes(24).toString('hex')}`,
      displayName: row.name,
      avatarUrl: row.avatarUrl,
      statusText: row.description?.slice(0, 80) ?? '',
      isAgent: true,
      emailVerifiedAt: new Date(),
      sponsorUserId: actorId,
      agentUsername: row.username,
      agentKeyHash: row.keyHash,
    });
    await tx.update(agentPairingRequests).set({ agentUserId: userId }).where(eq(agentPairingRequests.id, requestId));
    await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'member' });
    const general = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')))
      .limit(1);
    if (general[0]) {
      await tx.insert(channelMembers).values({ channelId: general[0].id, userId }).onConflictDoNothing();
    }
  });
  const userRow = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
  publishEvent(subjectMeta(workspaceId), {
    type: 'member.joined',
    workspaceId,
    ts: new Date().toISOString(),
    data: {
      userId,
      displayName: userRow.displayName,
      email: userRow.email,
      avatarUrl: userRow.avatarUrl,
      statusEmoji: userRow.statusEmoji,
      statusText: userRow.statusText,
      isAgent: true,
      sponsorId: actorId,
      role: 'member',
      joinedAt: new Date().toISOString(),
    },
  });
}

/** Sponsor denial: ends the pairing request immediately. */
export async function denyAgentRequest(requestId: string, actorId: string): Promise<void> {
  const updated = await db
    .update(agentPairingRequests)
    .set({ status: 'denied' })
    .where(
      and(
        eq(agentPairingRequests.id, requestId),
        eq(agentPairingRequests.sponsorUserId, actorId),
        eq(agentPairingRequests.status, 'pending'),
      ),
    )
    .returning();
  if (!updated[0]) throw notFound('pairing request not found');
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
