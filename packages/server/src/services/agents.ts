// First-class AI agents (AGENTS_DESIGN.md): invite → register → authenticate.
//
// Agents are real `users` rows (is_agent=true) and ordinary workspace members
// (always role 'member'), so channels, DMs, threads, reactions, files, typing,
// and presence work with zero special cases. The invite is key-based instead
// of email-based; the agent token is a non-expiring sibling of sessions.
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { AgentInviteDTO, AgentRegisterResponse } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { publishEvent, subjectMeta } from '../bus.js';
import { requireMembership } from './workspaces.js';
import { removeMemberDeep } from './memberRemoval.js';
import { toUserDTO } from './auth.js';

const { agentInvites, agentTokens, channels, channelMembers, users, workspaceMembers, workspaces } = schema;

const AGENT_INVITE_TTL_DAYS = 7;

async function requireAdmin(workspaceId: string, actorId: string) {
  const m = await requireMembership(workspaceId, actorId);
  if (m.role !== 'owner' && m.role !== 'admin') {
    throw forbidden('only owners and admins can manage agents');
  }
  return m;
}

/**
 * Mint an agent invite (owner/admin). The raw key `flow-agent-<token>` is
 * returned exactly once — only the hash is stored. Single-use, 7-day expiry.
 */
export async function createAgentInvite(
  workspaceId: string,
  actorId: string,
  nameHint?: string,
): Promise<AgentInviteDTO> {
  await requireAdmin(workspaceId, actorId);
  // opportunistic cleanup: expired never-used invites are dead weight
  await db.delete(agentInvites).where(and(lt(agentInvites.expiresAt, sql`now()`), isNull(agentInvites.usedAt)));
  const id = newId();
  const key = `flow-agent-${newToken()}`;
  const expiresAt = new Date(Date.now() + AGENT_INVITE_TTL_DAYS * 86400_000);
  await db.insert(agentInvites).values({
    id,
    workspaceId,
    tokenHash: hashToken(key),
    nameHint: nameHint ?? null,
    createdBy: actorId,
    expiresAt,
  });
  return { id, workspaceId, nameHint: nameHint ?? null, key, expiresAt: expiresAt.toISOString() };
}

/**
 * Consume an invite key (unauthenticated; single-use, replay-rejected,
 * expiry-checked — same discipline as app-link codes) → create the agent's
 * user row, join the workspace + #general, and mint the agent token. The raw
 * token `flow-agent-token-<token>` is returned exactly once.
 */
export async function registerAgent(input: {
  inviteKey: string;
  /** Optional — the agent self-identifies; falls back to the invite's nameHint. */
  name?: string | undefined;
  description?: string | undefined;
  avatarUrl?: string | undefined;
}): Promise<AgentRegisterResponse> {
  const userId = newId();
  const agentToken = `flow-agent-token-${newToken()}`;
  let workspaceId = '';
  await db.transaction(async (tx) => {
    // Atomic consume: the conditional UPDATE is the single-use gate — a replay
    // or expired key matches zero rows.
    const consumed = await tx
      .update(agentInvites)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(agentInvites.tokenHash, hashToken(input.inviteKey)),
          isNull(agentInvites.usedAt),
          gt(agentInvites.expiresAt, sql`now()`),
        ),
      )
      .returning();
    const inv = consumed[0];
    if (!inv) throw unauthorized('invalid, expired, or already-used agent invite key');
    workspaceId = inv.workspaceId;
    const name = input.name?.trim() || inv.nameHint?.trim();
    if (!name) throw badRequest('validation', 'name is required (no nameHint on the invite to fall back to)');
    // Same recipe as app bot users: synthetic unique email, unusable password
    // hash, emailVerifiedAt stamped (agents never do the email flow).
    await tx.insert(users).values({
      id: userId,
      email: `agent-${userId}@agents.flow.local`,
      passwordHash: `!agent:${randomBytes(24).toString('hex')}`,
      displayName: name,
      avatarUrl: input.avatarUrl ?? null,
      statusText: input.description?.slice(0, 80) ?? '',
      isAgent: true,
      emailVerifiedAt: new Date(),
    });
    await tx.update(agentInvites).set({ agentUserId: userId }).where(eq(agentInvites.id, inv.id));
    await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId, role: 'member' });
    const general = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, inv.workspaceId), eq(channels.name, 'general')))
      .limit(1);
    if (general[0]) {
      await tx.insert(channelMembers).values({ channelId: general[0].id, userId }).onConflictDoNothing();
    }
    await tx.insert(agentTokens).values({ id: newId(), tokenHash: hashToken(agentToken), userId });
  });

  const userRow = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
  const wsRow = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0]!;
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
      role: 'member',
      joinedAt: new Date().toISOString(),
    },
  });
  return {
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

/**
 * Regenerate an agent's token (owner/admin): revoke all live tokens, mint a
 * fresh one, return it raw exactly once. For "I lost my agent.json" — keeps
 * the agent's identity (name, DMs, message history) instead of forcing a
 * fresh invite → new user.
 */
export async function regenerateAgentToken(
  workspaceId: string,
  agentUserId: string,
  actorId: string,
): Promise<{ agentToken: string }> {
  await requireAdmin(workspaceId, actorId);
  const target = (await db.select().from(users).where(eq(users.id, agentUserId)).limit(1))[0];
  if (!target?.isAgent) throw notFound('agent not found');
  const membership = await db
    .select({ one: sql`1` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentUserId)))
    .limit(1);
  if (membership.length === 0) throw notFound('agent not found');
  const agentToken = `flow-agent-token-${newToken()}`;
  await db.transaction(async (tx) => {
    await tx
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentTokens.userId, agentUserId), isNull(agentTokens.revokedAt)));
    await tx.insert(agentTokens).values({ id: newId(), tokenHash: hashToken(agentToken), userId: agentUserId });
  });
  return { agentToken };
}

/**
 * Remove an agent (owner/admin) — same semantics as app removal: leave the
 * workspace + channels, delete 1:1 DMs, revoke every token, keep the user row
 * for authorship. Re-inviting mints a fresh identity.
 */
export async function removeAgent(workspaceId: string, agentUserId: string, actorId: string): Promise<void> {
  await requireAdmin(workspaceId, actorId);
  const target = (await db.select().from(users).where(eq(users.id, agentUserId)).limit(1))[0];
  if (!target?.isAgent) throw notFound('agent not found');
  const membership = await db
    .select({ one: sql`1` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agentUserId)))
    .limit(1);
  if (membership.length === 0) throw notFound('agent not found');
  await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.userId, agentUserId), isNull(agentTokens.revokedAt)));
  await removeMemberDeep(workspaceId, agentUserId);
}
