#!/usr/bin/env node
// QA "external Slack bot" peer (phase 4): a local Events API receiver that
// behaves like a real Slack app's bot server.
//
//   node scripts/qa-slackbot.mjs listen --port 8899 --secret <signing_secret> \
//        --events /tmp/qa/app-events.jsonl [--fail N]
//
// - Answers url_verification challenges (echoes the challenge).
// - Verifies X-Slack-Signature (v0 HMAC) on every request; bad signatures are
//   rejected 401 and logged with sig_ok:false.
// - Appends one JSON line per received event_callback to --events:
//     {"at":"<iso>","sig_ok":true,"envelope":{...}}
// - --fail N: respond 500 to the first N event_callback deliveries (exercises
//   the outbox retry/backoff/auto-disable path), then succeed.
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const opts = {};
const rest = process.argv.slice(3);
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
const mode = process.argv[2];
if (mode !== 'listen') {
  console.error('usage: qa-slackbot.mjs listen --port P --secret S --events FILE [--fail N]');
  process.exit(2);
}
const port = Number(opts.port ?? 8899);
const secret = opts.secret ?? '';
const eventsPath = opts.events ?? '/tmp/qa/app-events.jsonl';
let failRemaining = Number(opts.fail ?? 0);
fs.writeFileSync(eventsPath, '');

function verify(req, body) {
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig || !secret) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const sigOk = verify(req, body);
    let envelope = {};
    try {
      envelope = JSON.parse(body);
    } catch {
      /* keep {} */
    }
    if (envelope.type === 'url_verification') {
      // challenge round-trip (signature still checked and logged)
      fs.appendFileSync(
        eventsPath,
        JSON.stringify({ at: new Date().toISOString(), sig_ok: sigOk, envelope }) + '\n',
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ challenge: envelope.challenge }));
      return;
    }
    if (!sigOk) {
      fs.appendFileSync(
        eventsPath,
        JSON.stringify({ at: new Date().toISOString(), sig_ok: false, envelope }) + '\n',
      );
      res.writeHead(401);
      res.end('bad signature');
      return;
    }
    if (envelope.type === 'event_callback' && failRemaining > 0) {
      failRemaining -= 1;
      fs.appendFileSync(
        eventsPath,
        JSON.stringify({ at: new Date().toISOString(), sig_ok: true, simulated_failure: true, envelope }) + '\n',
      );
      res.writeHead(500);
      res.end('simulated failure');
      return;
    }
    fs.appendFileSync(
      eventsPath,
      JSON.stringify({ at: new Date().toISOString(), sig_ok: true, envelope }) + '\n',
    );
    res.writeHead(200);
    res.end('ok');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`qa-slackbot listening on http://127.0.0.1:${port} (fail-first: ${opts.fail ?? 0})`);
});
