#!/usr/bin/env node
// Email-first auth end-to-end test: register(email) → signup link → complete
// (name+password), no-enumeration responses, token single-use, forgot/reset,
// session revocation, dev autoVerify escape hatch.
// Requires the server running with the dev email driver (default); reads
// the signup/reset links out of the .emails/ outbox.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const OUTBOX =
  process.env.FLOW_EMAIL_OUTBOX ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.emails');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS:', n); };
const bad = (n, x) => { fail++; console.log('FAIL:', n, '--', x); };

async function raw(method, path_, token, body) {
  const res = await fetch(API + path_, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function api(method, path_, token, body) {
  const r = await raw(method, path_, token, body);
  if (r.status >= 400) throw new Error(`${method} ${path_} -> ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

/** Newest outbox email for an address; returns { subject, link, token }. */
async function lastEmail(to, param) {
  const files = (await fs.readdir(OUTBOX)).filter((f) => f.includes(to)).sort();
  if (!files.length) throw new Error(`no outbox email for ${to}`);
  const msg = JSON.parse(await fs.readFile(path.join(OUTBOX, files.at(-1)), 'utf8'));
  const link = msg.text.match(/https?:\/\/\S+/)?.[0];
  const token = link && param ? new URL(link).searchParams.get(param) : null;
  return { subject: msg.subject, link, token };
}

const ts = Date.now();
const email = `signup.${ts}@e2e.test`;
const password = 'password123';

// ---- email-first registration ----
const reg = await api('POST', '/v1/auth/register', null, { email });
reg.requiresVerification === true && !reg.token
  ? ok('register(email) -> requiresVerification, no session')
  : bad('register', JSON.stringify(reg));

const login1 = await raw('POST', '/v1/auth/login', null, { email, password });
login1.status === 401 ? ok('login before complete -> 401 (no account yet)') : bad('login gate', JSON.stringify(login1));

// ---- re-register resends and invalidates the first link ----
const first = await lastEmail(email, 'signup');
await api('POST', '/v1/auth/register', null, { email });
const second = await lastEmail(email, 'signup');
first.token && second.token && first.token !== second.token
  ? ok('re-register mints a fresh signup token')
  : bad('re-register', `${first.token} vs ${second.token}`);

const stale = await raw('POST', '/v1/auth/register/complete', null, {
  token: first.token, displayName: 'Stale', password,
});
stale.status === 401 ? ok('stale signup token rejected') : bad('stale signup token', stale.status);

// ---- complete creates the account and signs in ----
const done = await api('POST', '/v1/auth/register/complete', null, {
  token: second.token, displayName: 'Signup Me', password,
});
done.token && done.user?.email === email && done.user?.displayName === 'Signup Me'
  ? ok('complete -> account created + session')
  : bad('complete', JSON.stringify(done));

const replay = await raw('POST', '/v1/auth/register/complete', null, {
  token: second.token, displayName: 'Replay', password,
});
replay.status === 401 ? ok('signup token is single-use') : bad('signup replay', replay.status);

const login2 = await api('POST', '/v1/auth/login', null, { email, password });
login2.token ? ok('login after complete succeeds') : bad('login after complete', JSON.stringify(login2));

// ---- registering an existing email never leaks, notifies instead ----
const again = await api('POST', '/v1/auth/register', null, { email });
again.requiresVerification === true
  ? ok('register(existing email) -> same response (no enumeration)')
  : bad('register existing', JSON.stringify(again));
const note = await lastEmail(email);
note.subject.includes('already have')
  ? ok('existing email gets "already have an account" note')
  : bad('existing-account note', note.subject);

// ---- forgot/reset flow ----
const ghost = await api('POST', '/v1/auth/password/forgot', null, { email: `nobody.${ts}@e2e.test` });
ghost.ok === true ? ok('forgot for unknown email -> ok (no leak)') : bad('forgot unknown', JSON.stringify(ghost));

await api('POST', '/v1/auth/password/forgot', null, { email });
const resetMail = await lastEmail(email, 'reset');
resetMail.token ? ok('reset email delivered with token') : bad('reset email', JSON.stringify(resetMail));

const newPassword = 'brand-new-pass-456';
const reset = await api('POST', '/v1/auth/password/reset', null, { token: resetMail.token, password: newPassword });
reset.token ? ok('reset -> fresh session') : bad('reset', JSON.stringify(reset));

const oldSession = await raw('GET', '/v1/me', login2.token);
oldSession.status === 401 ? ok('old sessions revoked by reset') : bad('session revocation', oldSession.status);

const oldPw = await raw('POST', '/v1/auth/login', null, { email, password });
oldPw.status === 401 ? ok('old password rejected') : bad('old password', oldPw.status);

const newPw = await api('POST', '/v1/auth/login', null, { email, password: newPassword });
newPw.token ? ok('new password works') : bad('new password', JSON.stringify(newPw));

const resetReplay = await raw('POST', '/v1/auth/password/reset', null, { token: resetMail.token, password: 'x'.repeat(10) });
resetReplay.status === 401 ? ok('reset token is single-use') : bad('reset replay', resetReplay.status);

// ---- autoVerify escape hatch (dev driver only) ----
const auto = await api('POST', '/v1/auth/register', null, {
  email: `auto.${ts}@e2e.test`, password, displayName: 'Auto', autoVerify: true,
});
auto.token ? ok('autoVerify register -> instant session (dev driver)') : bad('autoVerify', JSON.stringify(auto));

const autoDup = await raw('POST', '/v1/auth/register', null, {
  email: `auto.${ts}@e2e.test`, password, displayName: 'Auto', autoVerify: true,
});
autoDup.status === 409 ? ok('autoVerify duplicate -> 409 (dev-only path keeps old contract)') : bad('autoVerify dup', autoDup.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
