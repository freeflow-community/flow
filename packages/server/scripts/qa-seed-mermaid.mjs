// #229 QA fixture: a channel whose messages cover every Mermaid diagram type
// the issue names, plus the invalid-syntax fallback. A fresh channel each run,
// because old QA-Lab channels can hold rows a new server process cannot
// decrypt. Run against a seeded server:
//   API=http://127.0.0.1:8790 node packages/server/scripts/qa-seed-mermaid.mjs
const API = process.env.API || 'http://127.0.0.1:8787';

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const login = await api('POST', '/v1/auth/login', null, {
  email: 'scott@qa.local',
  password: 'qa-password-1',
});
const token = login.token ?? login.session?.token;
const workspaces = await api('GET', '/v1/me/workspaces', token);
const ws = workspaces.workspaces.find((w) => w.slug === 'qa-lab') ?? workspaces.workspaces[0];

const name = `mermaid-${Date.now().toString(36)}`;
const created = await api('POST', `/v1/workspaces/${ws.id}/channels`, token, {
  name,
  topic: '#229 — Mermaid diagram rendering',
});
const channelId = created.channel?.id ?? created.id;

const fence = (source) => '```mermaid\n' + source + '\n```';

const MESSAGES = [
  'Diagram check for **#229** — every type the issue names.',
  'Flowchart:\n' + fence('flowchart LR\n  A[Client] --> B[Bridge]\n  B --> C[Server]'),
  'Sequence:\n' + fence('sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi there'),
  'State:\n' + fence('stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: work\n  Busy --> Idle: done\n  Busy --> [*]'),
  'Class:\n' + fence('classDiagram\n  class Message {\n    +String body\n    +send()\n  }\n  Message <|-- Reply'),
  'ER:\n' + fence('erDiagram\n  CHANNEL ||--o{ MESSAGE : holds\n  MESSAGE ||--o{ REACTION : has'),
  'Gantt:\n' + fence('gantt\n  title Rollout\n  dateFormat YYYY-MM-DD\n  section Dev\n  Build :a1, 2026-08-01, 5d\n  Ship  :after a1, 3d'),
  'Pie:\n' + fence('pie title Clients\n  "web" : 45\n  "macOS" : 30\n  "iOS" : 25'),
  'Broken syntax falls back to the code block plus the error:\n' + fence('flowchart LR\n  A[[[broken --> '),
  'A plain ```ts fence is still a code block:\n```ts\nconst x: number = 1;\n```',
];

for (const body of MESSAGES) {
  await api('POST', `/v1/channels/${channelId}/messages`, token, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
}

console.log(JSON.stringify({ workspaceSlug: ws.slug, channelName: name, channelId }, null, 2));
