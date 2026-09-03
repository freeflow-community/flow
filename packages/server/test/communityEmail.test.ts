// Community email (#481): the admin broadcast from the Directory.
//
// Two halves. The renderer half is pure and runs without a database. The
// service half is DB-backed against the dev postgres (docker compose in
// packages/infra, host port 5442), like the other service tests, with a fake
// EmailSender injected so nothing leaves the machine and individual sends can
// be made to fail on demand.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_community_email_test';
process.env.FLOW_DATA_KEY = randomBytes(32).toString('base64');

// self-sufficient: create the scratch database if it doesn't exist yet
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
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const cem = await import('../src/services/communityEmail.js');
const { _setEmailSenderForTests } = await import('../src/email/index.js');
const { _resetRateLimitsForTests } = await import('../src/lib/rateLimit.js');
const { renderMarkdownToEmailHtml, renderBroadcastEmailHtml, renderBroadcastEmailText } =
  await import('../src/email/render.js');
const { and, eq } = await import('drizzle-orm');

const { users, workspaceMembers } = schema;

interface SentMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Records everything sent; `failFor` makes exactly those addresses throw, the
 * way a permanent bounce surfaces out of CloudflareMailer. */
class FakeMailer {
  readonly sent: SentMail[] = [];
  failFor = new Set<string>();
  async send(msg: SentMail): Promise<void> {
    if (this.failFor.has(msg.to)) throw new Error(`permanent bounce for ${msg.to}`);
    this.sent.push(msg);
  }
}

let mailer: FakeMailer;
let owner = { id: '', email: '' };
let adminUser = { id: '', email: '' };
let plain = { id: '', email: '' };
let outsider = { id: '', email: '' };
let wsId = '';
let seq = 0;

function uniq(): number {
  seq += 1;
  return seq;
}

async function registerHuman(email: string, name: string): Promise<{ id: string; email: string }> {
  const res = await auth.register(email, { password: 'password123', displayName: name, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return { id: res.user.id, email };
}

/** A non-human member: agents and app bots both carry synthetic addresses. */
async function addSyntheticMember(kind: 'agent' | 'bot', name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    email: kind === 'agent' ? `agent-${id}@agents.flow.local` : `bot-${id}@apps.flow.local`,
    passwordHash: `!${kind}:${randomBytes(8).toString('hex')}`,
    displayName: name,
    isAgent: kind === 'agent',
    isBot: kind === 'bot',
    emailVerifiedAt: new Date(),
  });
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: id, role: 'member' });
  return id;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(
    `TRUNCATE users, workspaces, agent_invites, agent_tokens, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never,
  );
  owner = await registerHuman('owner@example.test', 'Olivia Owner');
  adminUser = await registerHuman('admin@example.test', 'Adam Admin');
  plain = await registerHuman('member@example.test', 'Mia Member');
  outsider = await registerHuman('outsider@example.test', 'Otto Outsider');
  wsId = (await ws.createWorkspace(owner.id, 'Locked In', `locked-in-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: adminUser.id, role: 'admin' });
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: plain.id, role: 'member' });
  await addSyntheticMember('agent', 'Builder');
  await addSyntheticMember('bot', 'Deploy Bot');
});

beforeEach(() => {
  mailer = new FakeMailer();
  _setEmailSenderForTests(mailer);
  // The test-send limiter is keyed per *user*, not per workspace, so
  // freshWorkspace() cannot clear it the way it clears the broadcast window.
  _resetRateLimitsForTests();
});

afterAll(async () => {
  _setEmailSenderForTests(null);
  await closeDb();
});

/** Each send burns the workspace's one-per-10-minutes window, so tests that
 * actually send do it against their own throwaway workspace. */
async function freshWorkspace(): Promise<string> {
  const id = (await ws.createWorkspace(owner.id, `Scratch ${uniq()}`, `scratch-${uniq()}-${Date.now()}`)).id;
  await db.insert(workspaceMembers).values({ workspaceId: id, userId: adminUser.id, role: 'admin' });
  await db.insert(workspaceMembers).values({ workspaceId: id, userId: plain.id, role: 'member' });
  return id;
}

describe('role gate', () => {
  it('lets an owner send', async () => {
    const id = await freshWorkspace();
    const res = await cem.sendBroadcast(id, owner.id, 'Hello', 'Hi everyone');
    expect(res.sent).toBe(3);
  });

  it('lets an admin send', async () => {
    const id = await freshWorkspace();
    const res = await cem.sendBroadcast(id, adminUser.id, 'Hello', 'Hi everyone');
    expect(res.sent).toBe(3);
  });

  it('403s a plain member', async () => {
    await expect(cem.sendBroadcast(wsId, plain.id, 'Hello', 'Hi')).rejects.toMatchObject({ statusCode: 403 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('403s a plain member on preview and on the recipient count too', async () => {
    await expect(cem.previewBroadcast(wsId, plain.id, 'Hi')).rejects.toMatchObject({ statusCode: 403 });
    await expect(cem.countBroadcastRecipients(wsId, plain.id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('404s a non-member rather than leaking that the workspace exists', async () => {
    await expect(cem.sendBroadcast(wsId, outsider.id, 'Hello', 'Hi')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('recipient filtering', () => {
  it('excludes agents and app bots', async () => {
    const id = await freshWorkspace();
    await cem.sendBroadcast(id, owner.id, 'Hello', 'Hi');
    const to = mailer.sent.map((m) => m.to).sort();
    expect(to).toEqual([adminUser.email, plain.email, owner.email].sort());
    expect(to.some((a) => a.endsWith('@agents.flow.local') || a.endsWith('@apps.flow.local'))).toBe(false);
  });

  it('excludes tombstoned users', async () => {
    const id = await freshWorkspace();
    const ghost = await registerHuman(`ghost-${uniq()}@example.test`, 'Ghost');
    await db.insert(workspaceMembers).values({ workspaceId: id, userId: ghost.id, role: 'member' });
    expect(await cem.countBroadcastRecipients(id, owner.id)).toBe(4);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, ghost.id));
    expect(await cem.countBroadcastRecipients(id, owner.id)).toBe(3);

    await cem.sendBroadcast(id, owner.id, 'Hello', 'Hi');
    expect(mailer.sent.map((m) => m.to)).not.toContain(ghost.email);
  });

  it('counts only the members of the named workspace', async () => {
    const a = await freshWorkspace();
    const solo = (await ws.createWorkspace(owner.id, `Solo ${uniq()}`, `solo-${uniq()}-${Date.now()}`)).id;
    expect(await cem.countBroadcastRecipients(a, owner.id)).toBe(3);
    expect(await cem.countBroadcastRecipients(solo, owner.id)).toBe(1);
  });
});

describe('batch resilience', () => {
  it('keeps going past a failing send and reports {sent, failed}', async () => {
    const id = await freshWorkspace();
    mailer.failFor.add(plain.email);
    const res = await cem.sendBroadcast(id, owner.id, 'Hello', 'Hi');
    expect(res).toEqual({ sent: 2, failed: 1 });
    // the other two still went out — one bounce is not a broadcast-wide abort
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([adminUser.email, owner.email].sort());
  });

  it('reports every address failing without throwing', async () => {
    const id = await freshWorkspace();
    mailer.failFor = new Set([owner.email, adminUser.email, plain.email]);
    expect(await cem.sendBroadcast(id, owner.id, 'Hello', 'Hi')).toEqual({ sent: 0, failed: 3 });
  });
});

describe('message shape', () => {
  it('sends HTML plus the markdown source as the text fallback, with attribution', async () => {
    const id = await freshWorkspace();
    await cem.sendBroadcast(id, owner.id, 'Meetup', '# Community meetup\n\nSee you **there**.');
    const mail = mailer.sent[0]!;
    expect(mail.subject).toBe('Meetup');
    expect(mail.html).toContain('<h1');
    expect(mail.html).toContain('<strong>there</strong>');
    expect(mail.html).toContain('Sent by Olivia Owner to all members of the');
    // plain-text alternative is the raw markdown, footer appended
    expect(mail.text).toContain('# Community meetup');
    expect(mail.text).toContain('See you **there**.');
    expect(mail.text).toContain('Sent by Olivia Owner');
  });

  it('previews byte-for-byte what the send would mail', async () => {
    const id = await freshWorkspace();
    const markdown = '## Notice\n\nDowntime [tonight](https://status.example.com).';
    const preview = await cem.previewBroadcast(id, owner.id, markdown);
    await cem.sendBroadcast(id, owner.id, 'Notice', markdown);
    expect(mailer.sent[0]!.html).toBe(preview.html);
    expect(preview.recipientCount).toBe(3);
  });
});

describe('rate limit', () => {
  it('allows one broadcast per workspace per window and 429s the second', async () => {
    const id = await freshWorkspace();
    await cem.sendBroadcast(id, owner.id, 'First', 'one');
    await expect(cem.sendBroadcast(id, owner.id, 'Second', 'two')).rejects.toMatchObject({ statusCode: 429 });
    // a different admin in the same workspace is limited too — the window
    // belongs to the workspace, not to whoever clicked send
    await expect(cem.sendBroadcast(id, adminUser.id, 'Third', 'three')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('does not let a rejected non-admin burn the workspace’s window', async () => {
    const id = await freshWorkspace();
    await expect(cem.sendBroadcast(id, plain.id, 'Nope', 'x')).rejects.toMatchObject({ statusCode: 403 });
    await expect(cem.sendBroadcast(id, owner.id, 'Yes', 'y')).resolves.toMatchObject({ sent: 3 });
  });

  it('preview is not rate-limited — typing is not broadcasting', async () => {
    const id = await freshWorkspace();
    for (let i = 0; i < 5; i++) {
      await expect(cem.previewBroadcast(id, owner.id, `draft ${i}`)).resolves.toBeTruthy();
    }
  });
});

// ---- "Send test to me" (#484) ----------------------------------------
describe('test send', () => {
  it('mails only the author, and nobody else in the workspace', async () => {
    const id = await freshWorkspace();
    const res = await cem.sendTestBroadcast(id, owner.id, 'Meetup', 'Hi everyone');
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(mailer.sent.map((m) => m.to)).toEqual([owner.email]);
  });

  it('sends to whoever clicked it, not to the workspace owner', async () => {
    const id = await freshWorkspace();
    await cem.sendTestBroadcast(id, adminUser.id, 'Meetup', 'Hi everyone');
    expect(mailer.sent.map((m) => m.to)).toEqual([adminUser.email]);
  });

  it('prefixes the subject so it cannot be mistaken for the broadcast', async () => {
    const id = await freshWorkspace();
    await cem.sendTestBroadcast(id, owner.id, 'Community meetup', 'Hi');
    expect(mailer.sent[0]!.subject).toBe('[Test] Community meetup');
  });

  it('is byte-identical to the broadcast apart from the subject', async () => {
    const id = await freshWorkspace();
    const markdown = '## Notice\n\nDowntime [tonight](https://status.example.com).';
    await cem.sendTestBroadcast(id, owner.id, 'Notice', markdown);
    await cem.sendBroadcast(id, owner.id, 'Notice', markdown);
    const test = mailer.sent[0]!;
    const real = mailer.sent.find((m) => m.to === owner.email && m !== test)!;
    expect(test.html).toBe(real.html);
    expect(test.text).toBe(real.text);
    expect(test.subject).toBe(`[Test] ${real.subject}`);
  });

  it('403s a plain member', async () => {
    await expect(cem.sendTestBroadcast(wsId, plain.id, 'Hello', 'Hi')).rejects.toMatchObject({ statusCode: 403 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('404s a non-member', async () => {
    await expect(cem.sendTestBroadcast(wsId, outsider.id, 'Hello', 'Hi')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports {sent: 0, failed: 1} instead of throwing when the address bounces', async () => {
    const id = await freshWorkspace();
    mailer.failFor.add(owner.email);
    expect(await cem.sendTestBroadcast(id, owner.id, 'Hello', 'Hi')).toEqual({ sent: 0, failed: 1 });
  });

  it('has its own per-user window: a second test 429s, a colleague is unaffected', async () => {
    const id = await freshWorkspace();
    await cem.sendTestBroadcast(id, owner.id, 'One', 'x');
    await expect(cem.sendTestBroadcast(id, owner.id, 'Two', 'y')).rejects.toMatchObject({ statusCode: 429 });
    // per user, so the other admin still gets their own test
    await expect(cem.sendTestBroadcast(id, adminUser.id, 'Three', 'z')).resolves.toEqual({ sent: 1, failed: 0 });
  });

  it('does not consume the broadcast window — a real send right after works', async () => {
    const id = await freshWorkspace();
    await cem.sendTestBroadcast(id, owner.id, 'Draft', 'x');
    await expect(cem.sendBroadcast(id, owner.id, 'Draft', 'x')).resolves.toEqual({ sent: 3, failed: 0 });
  });

  it('and the broadcast window does not consume the test one', async () => {
    const id = await freshWorkspace();
    await cem.sendBroadcast(id, owner.id, 'Draft', 'x');
    await expect(cem.sendTestBroadcast(id, owner.id, 'Draft', 'x')).resolves.toEqual({ sent: 1, failed: 0 });
  });

  it('gates on role before the limiter, so rejected attempts burn no window', async () => {
    const id = await freshWorkspace();
    for (let i = 0; i < 3; i++) {
      await expect(cem.sendTestBroadcast(id, plain.id, 'Nope', 'x')).rejects.toMatchObject({ statusCode: 403 });
    }
    await db
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, plain.id)));
    // promoted, and the three refusals cost them nothing
    await expect(cem.sendTestBroadcast(id, plain.id, 'Yes', 'y')).resolves.toEqual({ sent: 1, failed: 0 });
  });
});

// ---- renderer (pure, no database) ------------------------------------
describe('markdown → email HTML', () => {
  it('renders headings, emphasis, links, images and linked images', () => {
    const html = renderMarkdownToEmailHtml(
      [
        '# Title',
        '',
        'Some **bold** and *italic* and `code`.',
        '',
        '[link](https://example.com)',
        '',
        '![alt](https://cdn.example.com/a.png)',
        '',
        '[![banner](https://cdn.example.com/b.png)](https://example.com/go)',
        '',
        '- one',
        '- two',
      ].join('\n'),
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code');
    expect(html).toContain('href="https://example.com"');
    // links leave the mail client (and, in the Preview tab, must not navigate
    // the SPA away from the composer)
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    // linked image: the anchor wraps the img
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com\/go"[^>]*>\s*<img[^>]*src="https:\/\/cdn\.example\.com\/b\.png"/);
    expect(html).toContain('<li');
  });

  it('inlines styles, because email clients drop stylesheets', () => {
    const html = renderMarkdownToEmailHtml('# Title\n\nBody text.');
    expect(html).toMatch(/<h1[^>]*style="[^"]*font-size:24px/);
    expect(html).toMatch(/<p[^>]*style="[^"]*line-height:1\.6/);
    expect(html).not.toContain('<style');
    // list markers are stated, not inherited: the Preview tab renders this
    // inside the web app, whose reset would otherwise strip them
    expect(renderMarkdownToEmailHtml('- a\n- b')).toMatch(/<ul[^>]*style="[^"]*list-style:disc/);
    expect(renderMarkdownToEmailHtml('1. a\n2. b')).toMatch(/<ol[^>]*style="[^"]*list-style:decimal/);
  });

  it('strips injected <script> entirely — tag and contents', () => {
    const html = renderMarkdownToEmailHtml('Hi\n\n<script>alert("xss")</script>\n\nBye');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert');
  });

  it('strips inline event handlers and raw HTML that is not on the allow-list', () => {
    const html = renderMarkdownToEmailHtml(
      '<img src="https://x.example/a.png" onerror="alert(1)">\n\n<iframe src="https://evil.example"></iframe>\n\n<form><input name="p"></form>',
    );
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });

  it('drops javascript: and data: URLs', () => {
    const html = renderMarkdownToEmailHtml(
      '[click](javascript:alert(1))\n\n![x](data:text/html;base64,PHNjcmlwdD4=)\n\n[proto](//evil.example/x)',
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('//evil.example');
  });

  it('drops an author-supplied style attribute rather than merging it', () => {
    const html = renderMarkdownToEmailHtml('<p style="position:fixed;background:url(https://evil.example/t.gif)">hi</p>');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('hi');
  });

  it('escapes the sender and workspace names in the footer', () => {
    const html = renderBroadcastEmailHtml({
      markdown: 'hello',
      senderName: '<script>alert(1)</script>',
      workspaceName: 'A & B',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('wraps the body in an inline-styled shell with the attribution footer', () => {
    const html = renderBroadcastEmailHtml({
      markdown: '# Hi',
      senderName: 'Scott Persinger',
      workspaceName: 'Locked In',
    });
    expect(html).toContain('max-width:600px');
    expect(html).toContain('— Sent by Scott Persinger to all members of the Locked In workspace on Flow.');
  });

  it('text fallback is the untouched markdown plus the footer', () => {
    const md = '# Hi\n\n**bold** [link](https://example.com)';
    const text = renderBroadcastEmailText({ markdown: md, senderName: 'Scott', workspaceName: 'Locked In' });
    expect(text.startsWith(md)).toBe(true);
    expect(text).toContain('— Sent by Scott to all members of the Locked In workspace on Flow.');
  });
});
