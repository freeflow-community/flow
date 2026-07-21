#!/usr/bin/env node
// Fake coding-agent CLI for bridge e2e: speaks the claude stream-json contract
// (tool_use events, then a result) without needing the real claude CLI/auth.
// Echoes back which session flag it got so tests can assert continuity.
const args = process.argv.slice(2);
const val = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const sid = val('--session-id');
const rid = val('--resume');
const mode = sid ? 'new' : 'resume';
const id = sid ?? rid ?? 'none';
const prompt = args[args.length - 1] ?? '';
const hasHistory = prompt.includes('[recent conversation history]');
const lastLine = prompt.trim().split('\n').pop() ?? '';

out({ type: 'system', subtype: 'init', session_id: id });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo step-one' } }] } });
await sleep(1200);
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/step-two.txt' } }] } });
await sleep(1200);
out({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: `echo mode=${mode} sid=${id} hist=${hasHistory} :: ${lastLine}`,
});
