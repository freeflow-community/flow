// Scheduled messages (#419): the store, the scheduler tick, and the API's
// visibility and permission rules. DB-backed — scratch database on the dev
// postgres (docker compose in packages/infra, host port 5442).
//
// The tick is driven directly rather than by waiting on the 30s interval: what
// matters is the claim-and-advance semantics, not the timer.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL
  ?? 'postgres://flow:flow_dev@localhost:5442/flow_scheduled_messages_test';
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

const { migrate } = await import('../src/db/migrate.js');
const { db, schema, closeDb } = await import('../src/db/index.js');
const auth = await import('../src/services/auth.js');
const ws = await import('../src/services/workspaces.js');
const ch = await import('../src/services/channels.js');
const msg = await import('../src/services/messages.js');
const sm = await import('../src/services/scheduledMessages.js');
const { and, desc, eq } = await import('drizzle-orm');

const { channelMembers, messages, notifications, scheduledMessages, workspaceMembers } = schema;

let aliceId = ''; // author, workspace owner
let bobId = ''; // channel member, plain member
let carolId = ''; // workspace member, NOT in the channel
let agentId = ''; // mention target
let workspaceId = '';
let channelId = ''; // #standup — alice, bob, agent
let selfDmId = ''; // alice's "Just me"

const HOUR = 3_600_000;

async function register(email: string, displayName: string): Promise<string> {
  const res = await auth.register(email, { password: 'password123', displayName, autoVerify: true });
  if (!('token' in res)) throw new Error('expected autoVerify session');
  return res.user.id;
}

/** Latest top-level message in a channel, decrypted. */
async function latest(chanId: string) {
  const page = await msg.listMessages(chanId, aliceId, undefined, 5);
  return page.messages[0];
}

async function rowOf(id: string) {
  return (await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, id)).limit(1))[0]!;
}

/** Pretend the row came due at `when` — how every test here reaches the tick
 * without waiting on a real clock. */
async function makeDue(id: string, when: Date): Promise<void> {
  await db.update(scheduledMessages).set({ nextRunAt: when }).where(eq(scheduledMessages.id, id));
}

async function countIn(chanId: string): Promise<number> {
  const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.channelId, chanId));
  return rows.length;
}

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!);
  await db.execute(`TRUNCATE users, workspaces, sessions, invites, pending_signups RESTART IDENTITY CASCADE` as never);
  aliceId = await register('alice@example.test', 'Alice');
  bobId = await register('bob@example.test', 'Bob');
  carolId = await register('carol@example.test', 'Carol');
  agentId = await register('robo@example.test', 'Robo');

  const w = await ws.createWorkspace(aliceId, 'Sched Test', `sch-${randomUUID().slice(0, 8)}`);
  workspaceId = w.id;
  for (const uid of [bobId, carolId, agentId]) {
    await db.insert(workspaceMembers).values({ workspaceId, userId: uid, role: 'member' });
  }
  const chan = await ch.createChannel(workspaceId, aliceId, 'standup');
  channelId = chan.id;
  await ch.addMember(channelId, aliceId, bobId);
  await ch.addMember(channelId, aliceId, agentId);
  selfDmId = (await ch.createDm(workspaceId, aliceId, [])).id;
});

afterAll(async () => {
  await closeDb();
});

describe('create', () => {
  it('stores an encrypted body and a future next_run_at', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'standup in 5',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
      timezone: 'America/New_York',
    });
    expect(dto.body).toBe('standup in 5');
    expect(dto.enabled).toBe(true);
    expect(new Date(dto.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

    // the column is ciphertext, not the plaintext the DTO shows
    const row = await rowOf(dto.id);
    expect(row.body.toString('utf8')).not.toContain('standup');
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('refuses a destination the author is not in, and a schedule with no future', async () => {
    await expect(
      sm.createScheduledMessage(carolId, {
        channelId,
        body: 'sneaking in',
        recurrence: { type: 'daily', hour: 9, minute: 0 },
      }),
    ).rejects.toThrow(/join the destination/i);

    await expect(
      sm.createScheduledMessage(aliceId, {
        channelId,
        body: 'too late',
        recurrence: { type: 'once', at: new Date(Date.now() - HOUR).toISOString() },
      }),
    ).rejects.toThrow(/no future occurrence/i);

    await expect(
      sm.createScheduledMessage(aliceId, {
        channelId,
        body: 'nowhere',
        recurrence: { type: 'daily', hour: 9, minute: 0 },
        timezone: 'Mars/Olympus',
      }),
    ).rejects.toThrow(/unknown timezone/i);
  });
});

describe('the scheduler tick', () => {
  it('posts as the author, flagged scheduled, within one tick of due', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'good morning team',
      recurrence: { type: 'everyNHours', hours: 12, anchor: new Date(Date.now() + HOUR).toISOString() },
    });
    await makeDue(dto.id, new Date(Date.now() - 1000));

    expect(await sm.runSchedulerTick()).toBe(1);

    const posted = await latest(channelId);
    expect(posted?.body).toBe('good morning team');
    expect(posted?.userId).toBe(aliceId); // as the author, not as a bot
    expect(posted?.scheduled).toBe(true);

    const row = await rowOf(dto.id);
    expect(row.lastRunStatus).toBe('ok');
    expect(row.lastMessageId).toBe(posted!.id);
    expect(row.enabled).toBe(true);
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now()); // rolled forward
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('leaves ordinary messages unflagged', async () => {
    const typed = await msg.sendMessage(channelId, bobId, randomUUID(), 'typed by a person');
    expect(typed.scheduled).toBe(false);
  });

  it('a one-shot fires exactly once and disables itself', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'one and done',
      recurrence: { type: 'once', at: new Date(Date.now() + 5_000).toISOString() },
    });
    // Run the tick as if it were a minute later, rather than forcing the row's
    // due time — a one-shot's "next" is its own instant, so the row has to be
    // genuinely past for disabling itself to mean anything.
    const later = new Date(Date.now() + 60_000);

    const before = await countIn(channelId);
    await sm.runSchedulerTick(later);
    await sm.runSchedulerTick(later); // a second tick must find nothing
    expect(await countIn(channelId)).toBe(before + 1);

    const row = await rowOf(dto.id);
    expect(row.enabled).toBe(false);
    expect(row.nextRunAt).toBeNull();
    expect(row.lastRunStatus).toBe('ok');
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('a recurring rule keeps firing, one post per tick', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'every 12h',
      recurrence: { type: 'everyNHours', hours: 12, anchor: new Date(Date.now() + HOUR).toISOString() },
    });
    const before = await countIn(channelId);
    for (let i = 0; i < 3; i++) {
      await makeDue(dto.id, new Date(Date.now() - 1000));
      await sm.runSchedulerTick();
    }
    expect(await countIn(channelId)).toBe(before + 3);
    expect((await rowOf(dto.id)).enabled).toBe(true);
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('catches up exactly once after downtime, however many occurrences were missed', async () => {
    // Hourly, last due three days ago: the server was "down" for ~72 runs.
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'catch me up',
      recurrence: { type: 'hourly', minute: 0 },
    });
    await makeDue(dto.id, new Date(Date.now() - 3 * 24 * HOUR));

    const before = await countIn(channelId);
    await sm.runSchedulerTick();
    await sm.runSchedulerTick();
    expect(await countIn(channelId)).toBe(before + 1); // one catch-up post, not 72

    const row = await rowOf(dto.id);
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.nextRunAt!.getTime()).toBeLessThan(Date.now() + HOUR + 60_000); // back on cadence
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('a body mentioning an agent notifies it exactly like a typed message would', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: '@Robo please post the digest',
      recurrence: { type: 'hourly', minute: 0 },
    });
    await makeDue(dto.id, new Date(Date.now() - 1000));
    await sm.runSchedulerTick();

    const posted = await latest(channelId);
    expect(posted?.body).toBe(`<@${agentId}> please post the digest`); // expanded on the way in
    const notified = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, agentId), eq(notifications.messageId, posted!.id)));
    expect(notified).toHaveLength(1);
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });
});

describe('safety pause', () => {
  it('stops firing when the author leaves the destination, and tells them', async () => {
    const chan = await ch.createChannel(workspaceId, aliceId, `leavers-${randomUUID().slice(0, 6)}`);
    await ch.addMember(chan.id, aliceId, bobId);
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId: chan.id,
      body: 'still here?',
      recurrence: { type: 'hourly', minute: 0 },
    });
    await ch.removeMember(chan.id, aliceId, aliceId); // alice leaves

    const before = await countIn(chan.id);
    await makeDue(dto.id, new Date(Date.now() - 1000));
    await sm.runSchedulerTick();
    expect(await countIn(chan.id)).toBe(before); // nothing posted

    const row = await rowOf(dto.id);
    expect(row.enabled).toBe(false);
    expect(row.lastRunStatus).toBe('failed');
    expect(row.lastError).toMatch(/no longer a member/i);

    // the author hears about it in their own "Just me" conversation
    const dm = await db
      .select()
      .from(messages)
      .where(eq(messages.channelId, selfDmId))
      .orderBy(desc(messages.id))
      .limit(1);
    expect(dm[0]).toBeTruthy();
    expect(msg.toMessageDTO(dm[0]!).body).toMatch(/was paused/i);

    // Retrying by hand re-states the failure on the row but does not re-send
    // the note — the author already knows, and the same DM every click is noise.
    const notesBefore = await countIn(selfDmId);
    await sm.runScheduledMessageNow(dto.id, aliceId);
    expect(await countIn(selfDmId)).toBe(notesBefore);
    expect((await rowOf(dto.id)).lastRunStatus).toBe('failed');
  });
});

describe('visibility and permissions', () => {
  it('lists channel rows to channel members and personal rows to nobody else', async () => {
    const shared = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'shared row',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
    });
    const personal = await sm.createScheduledMessage(aliceId, {
      channelId: selfDmId,
      body: 'private note',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
    });

    const bobSees = (await sm.listScheduledMessages(workspaceId, bobId, false)).map((r) => r.id);
    expect(bobSees).toContain(shared.id);
    expect(bobSees).not.toContain(personal.id); // a self-DM has one member

    const carolSees = (await sm.listScheduledMessages(workspaceId, carolId, false)).map((r) => r.id);
    expect(carolSees).not.toContain(shared.id); // not in the channel
    expect(carolSees).not.toContain(personal.id);

    const aliceSees = (await sm.listScheduledMessages(workspaceId, aliceId, false)).map((r) => r.id);
    expect(aliceSees).toEqual(expect.arrayContaining([shared.id, personal.id]));

    // "Owned by me" narrows to the caller's own rows
    const bobsOwn = await sm.listScheduledMessages(workspaceId, bobId, true);
    expect(bobsOwn).toHaveLength(0);

    await sm.deleteScheduledMessage(shared.id, aliceId);
    await sm.deleteScheduledMessage(personal.id, aliceId);
  });

  it('marks canManage for the author and for admins, and refuses everyone else', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'mine',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
    });

    const asBob = (await sm.listScheduledMessages(workspaceId, bobId, false)).find((r) => r.id === dto.id);
    expect(asBob?.canManage).toBe(false);

    await expect(sm.updateScheduledMessage(dto.id, bobId, { body: 'hijacked' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(sm.deleteScheduledMessage(dto.id, bobId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(sm.setScheduledMessageEnabled(dto.id, bobId, false)).rejects.toMatchObject({ statusCode: 403 });

    // alice owns the workspace, so an admin can manage a row they didn't write
    await db.update(workspaceMembers).set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, bobId)));
    const edited = await sm.updateScheduledMessage(dto.id, bobId, { body: 'moderated' });
    expect(edited.body).toBe('moderated');
    await db.update(workspaceMembers).set({ role: 'member' })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, bobId)));

    await sm.deleteScheduledMessage(dto.id, aliceId);
  });
});

describe('pause, resume and run now', () => {
  it('pausing stops the tick from seeing it; resuming re-derives the next run', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'pausable',
      recurrence: { type: 'hourly', minute: 0 },
    });
    await sm.setScheduledMessageEnabled(dto.id, aliceId, false);
    await makeDue(dto.id, new Date(Date.now() - 1000));

    const before = await countIn(channelId);
    await sm.runSchedulerTick();
    expect(await countIn(channelId)).toBe(before); // paused rows are invisible to the claim

    const resumed = await sm.setScheduledMessageEnabled(dto.id, aliceId, true);
    expect(resumed.enabled).toBe(true);
    // resume never owes a backlog: the next run is derived from now
    expect(new Date(resumed.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });

  it('run now posts immediately and leaves the cadence alone', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'right now please',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
    });
    const scheduledFor = (await rowOf(dto.id)).nextRunAt!.getTime();

    const after = await sm.runScheduledMessageNow(dto.id, aliceId);
    const posted = await latest(channelId);
    expect(posted?.body).toBe('right now please');
    expect(posted?.scheduled).toBe(true);
    expect(new Date(after.nextRunAt!).getTime()).toBe(scheduledFor); // untouched
    expect(after.lastRunStatus).toBe('ok');
    await sm.deleteScheduledMessage(dto.id, aliceId);
  });
});

describe('editing', () => {
  it('round-trips body, recurrence and destination', async () => {
    const dto = await sm.createScheduledMessage(aliceId, {
      channelId,
      body: 'v1',
      recurrence: { type: 'daily', hour: 9, minute: 0 },
      timezone: 'America/New_York',
    });
    const updated = await sm.updateScheduledMessage(dto.id, aliceId, {
      body: 'v2',
      recurrence: { type: 'weekly', weekday: 1, hour: 9, minute: 30 },
      channelId: selfDmId,
    });
    expect(updated.body).toBe('v2');
    expect(updated.recurrence).toEqual({ type: 'weekly', weekday: 1, hour: 9, minute: 30 });
    expect(updated.channelId).toBe(selfDmId);
    expect(new Date(updated.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

    await sm.deleteScheduledMessage(dto.id, aliceId);
    await expect(sm.updateScheduledMessage(dto.id, aliceId, { body: 'gone' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
