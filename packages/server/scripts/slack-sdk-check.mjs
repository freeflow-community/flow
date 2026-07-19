#!/usr/bin/env node
// Real-SDK proof for the Slack-compat surface (phase4.md §1): drives the
// off-the-shelf @slack/web-api WebClient against a running Flow server.
// Happy path only — no rate limits exist yet (deferred per 2026-07-18 ruling 4),
// so retries are disabled.
//
// Usage: node scripts/slack-sdk-check.mjs --token xoxb-... [--url http://127.0.0.1:8787/api/]
import { WebClient } from '@slack/web-api';

const argv = process.argv.slice(2);
let token = null;
let apiUrl = 'http://127.0.0.1:8787/api/';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--token') token = argv[++i];
  else if (argv[i] === '--url') apiUrl = argv[++i];
}
if (!token) {
  console.error('usage: node scripts/slack-sdk-check.mjs --token xoxb-... [--url <base>]');
  process.exit(2);
}

const client = new WebClient(token, { slackApiUrl: apiUrl, retryConfig: { retries: 0 } });

let failures = 0;
async function step(name, fn) {
  try {
    const out = await fn();
    console.log(`PASS ${name}`);
    return out;
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err?.data?.error ?? err.message}`);
    return null;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const auth = await step('auth.test', async () => {
  const r = await client.auth.test();
  assert(r.ok && r.user_id && r.team_id, 'missing auth.test fields');
  return r;
});

const list = await step('conversations.list', async () => {
  const r = await client.conversations.list({ types: 'public_channel' });
  assert(Array.isArray(r.channels) && r.channels.length > 0, 'no public channels returned');
  return r;
});

const general = list?.channels?.find((c) => c.name === 'general');

await step('conversations.join #general', async () => {
  assert(general, 'no #general channel found');
  const r = await client.conversations.join({ channel: general.id });
  assert(r.channel?.is_member === true, 'join did not report membership');
});

const marker = `sdk-check ${Date.now()}`;
const posted = await step('chat.postMessage', async () => {
  const r = await client.chat.postMessage({ channel: general.id, text: `*${marker}* &check <https://example.com|link>` });
  assert(r.ts && r.channel === general.id, 'missing ts/channel');
  assert(r.message?.text?.includes(marker), 'echoed message text missing marker');
  return r;
});

await step('conversations.history contains own message with matching ts', async () => {
  const r = await client.conversations.history({ channel: general.id, limit: 20 });
  const mine = r.messages?.find((m) => m.ts === posted?.ts);
  assert(mine, 'posted message not found in history by ts');
  assert(mine.user === auth?.user_id, 'message user is not the bot');
  assert(mine.text.includes(marker), 'history text missing marker');
});

await step('chat.update', async () => {
  const r = await client.chat.update({ channel: general.id, ts: posted.ts, text: `${marker} (edited)` });
  assert(r.ts === posted.ts, 'update returned different ts');
  assert(r.text?.includes('(edited)'), 'updated text not reflected');
});

await step("reactions.add('thumbsup')", async () => {
  await client.reactions.add({ channel: general.id, timestamp: posted.ts, name: 'thumbsup' });
});

const reply = await step('chat.postMessage (threaded)', async () => {
  const r = await client.chat.postMessage({ channel: general.id, text: 'threaded reply', thread_ts: posted.ts });
  assert(r.message?.thread_ts === posted.ts, 'reply missing thread_ts');
  return r;
});

await step('conversations.replies', async () => {
  const r = await client.conversations.replies({ channel: general.id, ts: posted.ts });
  assert(r.messages?.[0]?.ts === posted.ts, 'thread root not first');
  assert(r.messages?.some((m) => m.ts === reply?.ts), 'reply not present in thread');
});

await step('chat.delete (reply, then root)', async () => {
  await client.chat.delete({ channel: general.id, ts: reply.ts });
  await client.chat.delete({ channel: general.id, ts: posted.ts });
});

console.log(failures === 0 ? 'ALL PASS' : `${failures} step(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
