// Server-side @-mention expansion on the message-create path (issue #415):
// an API-posted `@Name` becomes a real `<@userId>` mention — notifications and
// app_mention events included — while a client session's body is stored
// verbatim (the composer resolves its own mentions). DB-backed — scratch
// database on the dev postgres (docker compose in packages/infra, host 5442).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_mention_expansion_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

{
  const { default: postgres } = await import('postgres');
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`).catch(() => {}); // 42P04 duplicate_database
  await admin.end();
}

// dynamic imports so the env above is set before config/db read it
const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const ag = await import('../src/services/agents.js');
const { and, eq } = await import('drizzle-orm');

const { notifications, workspaceMembers } = schema;

let ownerId = '';
let ownerToken = '';
let prismId = '';
let scottId = '';
let agentToken = '';
let workspaceId = '';
let channelId = '';
let app: Awaited<ReturnType<typeof buildApp>>;
let cmid = 0;
const nextCmid = (): string => `00000000-0000-4000-8000-${String(++cmid).padStart(12, '0')}`;

async function registerHuman(email: string, name: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  ownerToken = res.token;
  return res.user.id;
}

/** Post through the real HTTP route, as an agent token or a session token. */
async function post(token: string, body: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/channels/${channelId}/messages`,
    headers: { authorization: `Bearer ${token}` },
    payload: { clientMsgId: nextCmid(), body, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; body: string };
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, agent_invites, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  ownerId = await registerHuman('owner@example.test', 'Owner');
  const ownerSessionToken = ownerToken;
  prismId = await registerHuman('prism@example.test', 'Prism');
  scottId = await registerHuman('scott@example.test', 'Scott Persinger');
  ownerToken = ownerSessionToken;

  const wsDto = await ws.createWorkspace(ownerId, 'Mention WS', `mentions-${Date.now()}`);
  workspaceId = wsDto.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: prismId, role: 'member' },
    { workspaceId, userId: scottId, role: 'member' },
  ]);
  channelId = (await ch.createChannel(workspaceId, ownerId, `mentions-${Date.now()}`)).id;
  await ch.addMember(channelId, ownerId, prismId);

  const invite = await ag.createAgentInvite(workspaceId, ownerId);
  const agent = await ag.redeemAgentInvite({
    code: invite.code,
    username: 'poster',
    key: `flow-agent-key-${randomBytes(24).toString('base64url')}`,
    name: 'Poster',
  });
  agentToken = agent.agentToken;

  app = buildApp();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('API-posted mention expansion (#415)', () => {
  it('expands @Name for an agent token and notifies the mentioned member', async () => {
    const dto = await post(agentToken, 'hey @Prism can you look at this?');
    expect(dto.body).toBe(`hey <@${prismId}> can you look at this?`);

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.messageId, dto.id), eq(notifications.userId, prismId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe(0); // mention — same as a composer-typed one
    expect(rows[0]!.subkind).toBe('mention');
  });

  it('resolves a multi-word display name as one mention', async () => {
    const dto = await post(agentToken, 'ping @Scott Persinger about the release');
    expect(dto.body).toBe(`ping <@${scottId}> about the release`);
  });

  it('leaves unknown names and code spans alone', async () => {
    const dto = await post(agentToken, 'ask @Nobody, and `@Prism` is literal');
    expect(dto.body).toBe('ask @Nobody, and `@Prism` is literal');
  });

  it('stores the body verbatim when expandMentions is false', async () => {
    const dto = await post(agentToken, 'verbatim @Prism please', { expandMentions: false });
    expect(dto.body).toBe('verbatim @Prism please');
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.messageId, dto.id), eq(notifications.userId, prismId)));
    expect(rows).toHaveLength(0);
  });

  it('leaves a client session’s body alone — the composer resolves its own mentions', async () => {
    const dto = await post(ownerToken, 'typed @Prism by hand');
    expect(dto.body).toBe('typed @Prism by hand');
  });

  it('honours an explicit expandMentions:true from a client session', async () => {
    const dto = await post(ownerToken, 'opt in @Prism', { expandMentions: true });
    expect(dto.body).toBe(`opt in <@${prismId}>`);
  });

  it('passes an existing <@userId> token through untouched', async () => {
    const dto = await post(agentToken, `already <@${prismId}> resolved`);
    expect(dto.body).toBe(`already <@${prismId}> resolved`);
  });
});
