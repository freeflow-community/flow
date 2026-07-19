#!/usr/bin/env node
// Email-auth end-to-end test: registration → verify link → login gate,
// resend, forgot/reset password, token single-use + session revocation.
// Requires the server running with the dev email driver (default); reads
// the verify/reset links out of the .emails/ outbox.
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
  const token = link ? new URL(link).searchParams.get(param) : null;
  return { subject: msg.subject, link, token };
}

const ts = Date.now();
const email = `verifyme.${ts}@e2e.test`;
const password = 'password123';

// ---- registration requires verification ----
const reg = await api('POST', '/v1/auth/register', null, { email, password, displayName: 'Verify Me' });
reg.requiresVerification === true && !reg.token
  ? ok('register -> requiresVerification, no session')
  : bad('register', JSON.stringify(reg));

const login1 = await raw('POST', '/v1/auth/login', null, { email, password });
login1.status === 403 && login1.json.error?.code === 'email_not_verified'
  ? ok('login before verify -> 403 email_not_verified')
  : bad('login gate', JSON.stringify(login1));

// ---- resend invalidates the first token ----
const first = await lastEmail(email, 'verify');
await api('POST', '/v1/auth/verify-email/resend', null, { email });
const second = await lastEmail(email, 'verify');
first.token && second.token && first.token !== second.token
  ? ok('resend mints a fresh token')
  : bad('resend', `${first.token} vs ${second.token}`);

const stale = await raw('POST', '/v1/auth/verify-email', null, { token: first.token });
stale.status === 401 ? ok('stale verify token rejected') : bad('stale verify token', stale.status);

// ---- verify link signs in ----
const verified = await api('POST', '/v1/auth/verify-email', null, { token: second.token });
verified.token && verified.user?.email === email
  ? ok('verify -> session issued')
  : bad('verify', JSON.stringify(verified));

const replay = await raw('POST', '/v1/auth/verify-email', null, { token: second.token });
replay.status === 401 ? ok('verify token is single-use') : bad('verify replay', replay.status);

const login2 = await api('POST', '/v1/auth/login', null, { email, password });
login2.token ? ok('login after verify succeeds') : bad('login after verify', JSON.stringify(login2));

// ---- unknown email never leaks account existence ----
const ghost = await api('POST', '/v1/auth/password/forgot', null, { email: `nobody.${ts}@e2e.test` });
ghost.ok === true ? ok('forgot for unknown email -> ok (no leak)') : bad('forgot unknown', JSON.stringify(ghost));

// ---- forgot/reset flow ----
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
