#!/usr/bin/env node
// QA fixtures for the artifacts UI (#157): a `docs157` channel in the QA Lab
// workspace holding one artifact of each interesting kind — HTML (the agent
// task-board case), text, image, and a link. Idempotent; run after qa-seed.mjs.
//
// Usage: node scripts/qa-seed-artifacts.mjs        (API=… to point elsewhere)
const API = process.env.API ?? 'http://127.0.0.1:8787';
const PASSWORD = 'qa-password-1';

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function upload(wsId, token, filename, mimeType, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  const res = await fetch(`${API}/v1/workspaces/${wsId}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`upload ${filename} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const alice = await api('POST', '/v1/auth/login', null, { email: 'alice@qa.local', password: PASSWORD });
const mine = await api('GET', '/v1/me/workspaces', alice.token);
const ws = mine.workspaces.find((w) => w.slug === 'qa-lab');
if (!ws) throw new Error('run qa-seed.mjs first');

const chans = await api('GET', `/v1/workspaces/${ws.id}/channels`, alice.token);
let ch = chans.channels.find((c) => c.name === 'docs157');
if (!ch) ch = await api('POST', `/v1/workspaces/${ws.id}/channels`, alice.token, { name: 'docs157' });

const existing = await api('GET', `/v1/workspaces/${ws.id}/artifacts`, alice.token);
const have = new Set(existing.artifacts.filter((a) => a.channelId === ch.id).map((a) => a.name));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:16px -apple-system,system-ui;margin:0;padding:20px;background:#fbfaf8;color:#39342f}
h1{font-size:20px;margin:0 0 14px}
.row{display:flex;gap:10px;align-items:center;padding:9px 11px;border:1px solid #e7e3db;border-radius:9px;background:#fff;margin-bottom:8px}
.n{font-variant-numeric:tabular-nums;color:#a49d94;width:34px}
.s{margin-left:auto;font-size:12px;padding:2px 9px;border-radius:99px;background:#f0ede7;color:#635d56}
.p{background:#efe6fb;color:#5528a9}
</style></head><body>
<h1>Flow work queue</h1>
<div class="row"><span class="n">#157</span><span>iOS artifact support</span><span class="s p">In Progress</span></div>
<div class="row"><span class="n">#105</span><span>iOS text zoom</span><span class="s p">In Progress</span></div>
<div class="row"><span class="n">#124</span><span>Sign in with Apple</span><span class="s">Done</span></div>
<div class="row"><span class="n">#85</span><span>Join-link management</span><span class="s">Queued for Dev</span></div>
</body></html>`;

const md = `# Release notes — 2026-07-30

- iPhone: a Docs button in the channel header, badged with how many
  documents the channel has.
- Tap it for the list; tap a document to read it full screen.

This file is a text artifact: it renders in the monospace pane, not
QuickLook, and shares out with the system share sheet.
`;

// 8x8 solid PNG (deterministic bytes, no image lib needed).
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR42u3PMQEAAAgDoK1/aM3g' +
    '4QcJSCe1Q3gEAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQI' +
    'ECBAgAABAgQIvC0LqAAB6+gI+wAAAABJRU5ErkJggg==',
  'base64',
);

const wanted = [
  ['task-board.html', 'text/html', Buffer.from(html)],
  ['release-notes.md', 'text/markdown', Buffer.from(md)],
  ['brand-swatch.png', 'image/png', png],
];

for (const [name, mime, bytes] of wanted) {
  if (have.has(name)) continue;
  const file = await upload(ws.id, alice.token, name, mime, bytes);
  await api('POST', '/v1/artifacts', alice.token, { channelId: ch.id, fileId: file.id, name });
}

if (!have.has('freeflow.im')) {
  await api('POST', '/v1/artifacts', alice.token, {
    channelId: ch.id,
    url: 'https://freeflow.im',
    name: 'freeflow.im',
  });
}

await api('POST', `/v1/channels/${ch.id}/messages`, alice.token, {
  body: 'Pinned the board and the notes — tap Docs up top.',
  clientMsgId: crypto.randomUUID(),
});

const after = await api('GET', `/v1/workspaces/${ws.id}/artifacts`, alice.token);
console.log(
  JSON.stringify(
    {
      channel: ch.name,
      channelId: ch.id,
      artifacts: after.artifacts.filter((a) => a.channelId === ch.id).map((a) => ({ name: a.name, kind: a.kind })),
    },
    null,
    2,
  ),
);
