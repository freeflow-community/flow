#!/usr/bin/env node
// QA bot: an API-driven peer that replaces the second app window during UI testing.
// The server can't tell it apart from a real client, so one live UI (Alice) can be
// verified against a scripted counterpart (Bob) at millisecond cost.
//
// Long-running listener (persistent WS = real presence; logs every event received):
//   node scripts/qa-bot.mjs listen --token T --events /tmp/qa/bob-events.jsonl \
//        [--cmds /tmp/qa/bob-cmds.jsonl]
//   The events file gets one JSON line per WS frame: {"at":"<iso>","event":{...}}.
//   Assert receipt with grep, e.g.: grep -c '"message.created"' bob-events.jsonl
//   The cmds file (optional) is watched for appended JSON lines to act over the SAME
//   socket (needed for typing; also lets you quit):
//     {"op":"typing","channelId":"..."}
//     {"op":"quit"}
//
// One-shot REST actions (print the API response as JSON):
//   node scripts/qa-bot.mjs send --token T --channel C --body "hi" [--thread ROOTID]
//   node scripts/qa-bot.mjs edit --token T --message M --body "new text"
//   node scripts/qa-bot.mjs delete --token T --message M
//   node scripts/qa-bot.mjs read --token T --channel C --message M   (mark read up to M)
//   node scripts/qa-bot.mjs messages --token T --channel C [--limit 20]
import WebSocket from 'ws';
import fs from 'node:fs';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const WS_URL = API.replace('http', 'ws') + '/v1/ws';

const [mode, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
const need = (k) => {
  if (!opts[k]) { console.error(`missing --${k}`); process.exit(2); }
  return opts[k];
};

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${need('token')}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`); process.exit(1); }
  console.log(JSON.stringify(json, null, 2));
  return json;
}

switch (mode) {
  case 'send':
    await api('POST', `/v1/channels/${need('channel')}/messages`, {
      clientMsgId: crypto.randomUUID(),
      body: need('body'),
      ...(opts.thread ? { threadRootId: opts.thread } : {}),
    });
    break;
  case 'edit':
    await api('PATCH', `/v1/messages/${need('message')}`, { body: need('body') });
    break;
  case 'delete':
    await api('DELETE', `/v1/messages/${need('message')}`);
    break;
  case 'read':
    await api('POST', `/v1/channels/${need('channel')}/read`, { lastReadMsgId: need('message') });
    break;
  case 'messages':
    await api('GET', `/v1/channels/${need('channel')}/messages?limit=${opts.limit ?? 20}`);
    break;
  case 'react': // add (default) or remove with --remove true
    await api(opts.remove ? 'DELETE' : 'PUT',
      `/v1/messages/${need('message')}/reactions/${encodeURIComponent(need('emoji'))}`);
    break;
  case 'dm': // upsert a DM channel: --workspace W --users "id1,id2"
    await api('POST', `/v1/workspaces/${need('workspace')}/dms`, {
      userIds: need('users').split(','),
    });
    break;
  case 'upload': { // --workspace W --path /file.png [--mime image/png]; prints FileDTO
    const path = need('path');
    const blob = new Blob([fs.readFileSync(path)], { type: opts.mime ?? 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, path.split('/').pop());
    const res = await fetch(`${API}/v1/workspaces/${need('workspace')}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${need('token')}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`upload -> ${res.status}: ${JSON.stringify(json)}`); process.exit(1); }
    console.log(JSON.stringify(json, null, 2));
    break;
  }
  case 'send-file': // send a message with attachments: --channel C --body B --files "id1,id2"
    await api('POST', `/v1/channels/${need('channel')}/messages`, {
      clientMsgId: crypto.randomUUID(),
      body: need('body'),
      fileIds: need('files').split(','),
    });
    break;
  case 'mention': // send a message mentioning users: --channel C --body B --users "id1,id2"
    await api('POST', `/v1/channels/${need('channel')}/messages`, {
      clientMsgId: crypto.randomUUID(),
      body: need('body'),
      mentions: need('users').split(','),
    });
    break;
  case 'notifications':
    await api('GET', `/v1/me/notifications?limit=${opts.limit ?? 20}`);
    break;
  case 'notify-level': // --channel C --level 0|1|2
    await api('PUT', `/v1/channels/${need('channel')}/notify`, { level: Number(need('level')) });
    break;
  case 'profile': // --name "New Name" and/or --tz "America/New_York"
    await api('PATCH', '/v1/me', {
      ...(opts.name ? { displayName: opts.name } : {}),
      ...(opts.tz ? { timezone: opts.tz } : {}),
    });
    break;
  case 'listen': {
    const eventsPath = need('events');
    const token = need('token');
    fs.writeFileSync(eventsPath, '');
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => ws.send(JSON.stringify({ op: 'auth', token })));
    ws.on('message', (raw) => {
      const f = JSON.parse(String(raw));
      if (f.op === 'ping') return ws.send(JSON.stringify({ op: 'pong' }));
      fs.appendFileSync(eventsPath, JSON.stringify({ at: new Date().toISOString(), ...f }) + '\n');
      if (f.op === 'hello') console.log('listening (hello received)');
    });
    ws.on('close', () => { console.log('socket closed'); process.exit(0); });
    ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
    if (opts.cmds) {
      fs.writeFileSync(opts.cmds, '');
      let offset = 0;
      setInterval(() => {
        const text = fs.readFileSync(opts.cmds, 'utf8');
        if (text.length <= offset) return;
        const fresh = text.slice(offset);
        offset = text.length;
        for (const line of fresh.split('\n')) {
          if (!line.trim()) continue;
          try {
            const cmd = JSON.parse(line);
            if (cmd.op === 'quit') { ws.close(); return; }
            if (cmd.op === 'typing') ws.send(JSON.stringify({ op: 'typing', channelId: cmd.channelId }));
          } catch (e) {
            console.error('bad cmd line:', line, e.message);
          }
        }
      }, 200);
    }
    break;
  }
  default:
    console.error('usage: qa-bot.mjs listen|send|edit|delete|read|messages|react|dm|upload|send-file|mention|notifications|notify-level|profile --token T ...');
    process.exit(2);
}
