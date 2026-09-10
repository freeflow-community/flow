#!/usr/bin/env node
// The web half of the multi-server acceptance matrix (#542,
// docs/specs/multi-server-workspaces.md § "Delivery and acceptance").
//
// Runs against two `pnpm qa:up --collide` backends, which share user,
// workspace, channel and file ids on purpose: every check below would pass
// vacuously against two ordinarily seeded servers, because nothing could
// confuse two rows that have nothing in common.
//
//   pnpm qa:up --name=a --collide
//   pnpm qa:up --name=b --collide --allow-origin=<A's origin>
//   PLAYWRIGHT_HOME=<dir with playwright> \
//     node docs/qa/issue-542/acceptance-web.mjs [--headed] [--shots <dir>]
//
// The page is served from A. That is the real deployment shape — one web
// client, several backends — and it is why only B needs an allowed origin.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright is not a repo dependency — the web package has no browser tests —
// so point PLAYWRIGHT_HOME at any directory that has it installed:
//   mkdir /tmp/pw && cd /tmp/pw && npm i playwright
//   PLAYWRIGHT_HOME=/tmp/pw node docs/qa/issue-542/acceptance-web.mjs
const require = createRequire(
  process.env.PLAYWRIGHT_HOME ? path.join(process.env.PLAYWRIGHT_HOME, 'package.json') : import.meta.url,
);
const { chromium } = require('playwright');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const shotsDir = flag('shots') ?? path.join(repoRoot, 'docs', 'qa', 'issue-542');
const headed = args.includes('--headed');

const stack = (name) => JSON.parse(fs.readFileSync(path.join(repoRoot, '.qa', `stack-${name}.json`), 'utf8'));
const A = stack('a');
const B = stack('b');
const seedOf = (s) => JSON.parse(fs.readFileSync(s.seedPath, 'utf8'));
const seedA = seedOf(A);
const seedB = seedOf(B);

/** Fresh sessions, rather than the tokens `qa:up` printed once.
 * This run signs out of A at the end, which revokes whatever token it used —
 * so reading them from seed.json would make the script work exactly once. */
async function login(api, email, password) {
  const res = await fetch(`${api}/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} on ${api}: ${res.status}`);
  return (await res.json()).token;
}
for (const [stack, seed] of [[A, seedA], [B, seedB]]) {
  seed.alice.token = await login(stack.api, seed.alice.email, seed.password);
  seed.bob.token = await login(stack.api, seed.bob.email, seed.password);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log(`A ${A.api}  B ${B.api}`);
console.log(`shared workspace id ${seedA.workspaceId} / ${seedB.workspaceId}`);
console.log(`shared channel id   ${seedA.generalChannelId} / ${seedB.generalChannelId}\n`);
if (seedA.workspaceId !== seedB.workspaceId || seedA.generalChannelId !== seedB.generalChannelId) {
  console.error('These stacks do not collide — bring them up with --collide.');
  process.exit(2);
}

/** Post as Bob, mentioning Alice — a mention is what raises a notification,
 * and the notification count is what the switcher badges. */
const mention = async (api, seed, text) => {
  const res = await fetch(`${api}/v1/channels/${seed.generalChannelId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${seed.bob.token}` },
    body: JSON.stringify({
      clientMsgId: randomUUID(),
      body: `<@${seed.alice.userId}> ${text}`,
      mentions: [seed.alice.userId],
    }),
  });
  if (!res.ok) throw new Error(`post failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });

// Every request the page makes, with the bearer it carried. This is the
// evidence for "no bearer forwarding across origin/port/scheme changes".
const sent = [];
await context.route('**/*', async (route) => {
  const request = route.request();
  const auth = request.headers()['authorization'] ?? null;
  sent.push({ url: request.url(), auth });
  await route.continue();
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = async (name) => {
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: false });
};

try {
  // ---- signed in on A, the migrated default connection --------------------
  await page.goto(`${A.api}/`);
  await page.evaluate(([token, ws]) => {
    localStorage.setItem('flow.token', token);
    localStorage.setItem('flow.activeWorkspace', ws);
  }, [seedA.alice.token, seedA.workspaceId]);
  await page.goto(`${A.api}/`);
  await page.getByText('A-ONLY', { exact: false }).first().waitFor({ timeout: 20_000 });
  check('A: signed in and showing A-only content', true);

  // ---- add B from the switcher -------------------------------------------
  await page.getByRole('button', { name: 'Workspaces and servers' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspaces and servers' });
  await dialog.waitFor();
  await dialog.getByLabel('Server or invite URL').fill(B.api);
  await dialog.getByRole('button', { name: 'Check server' }).click();
  await dialog.getByText(`Sign in to ${new URL(B.api).host}`).waitFor({ timeout: 15_000 });
  check('B: destination disclosed before any credential is typed', true, new URL(B.api).host);
  await shot('web-add-second-server');

  await dialog.getByLabel('Email on this server').fill(seedB.alice.email);
  await dialog.getByLabel('Password on this server').fill(seedB.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByText(seedB.alice.email).first().waitFor({ timeout: 15_000 });
  // Same email as A's account, deliberately: it must never link the identities.
  check('same email on both servers stays two separate accounts', seedA.alice.email === seedB.alice.email,
    seedA.alice.email);
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: /Add selected workspaces/ }).click();

  // ---- the switch itself --------------------------------------------------
  await page.getByText('B-ONLY', { exact: false }).first().waitFor({ timeout: 20_000 });
  const leaked = await page.getByText('A-ONLY', { exact: false }).count();
  check('switching to B shows B, and not A, despite identical workspace + channel ids', leaked === 0,
    `A-only rows visible on B: ${leaked}`);
  await shot('web-switched-to-b');

  // ---- no bearer crosses an origin ---------------------------------------
  const crossed = sent.filter((r) => r.auth && (
    (r.url.startsWith(B.api) && r.auth.includes(seedA.alice.token)) ||
    (r.url.startsWith(A.api) && r.auth.includes(seedB.alice.token))
  ));
  check('no bearer is ever sent to the other backend', crossed.length === 0,
    crossed.length ? crossed[0].url : `${sent.filter((r) => r.auth).length} authenticated requests checked`);

  // ---- drafts are per connection, on the same channel id ------------------
  const DRAFT = 'draft that belongs to server B only';
  // `contentEditable="plaintext-only"`, so `[contenteditable="true"]` misses it.
  const composer = page.getByRole('textbox', { name: /^Message / }).first();
  await composer.click();
  await composer.pressSequentially(DRAFT, { delay: 5 });
  await page.waitForTimeout(600);
  await shot('web-draft-on-b');
  await selectServer(page, new URL(A.api).host);
  await page.getByText('A-ONLY', { exact: false }).first().waitFor({ timeout: 20_000 });
  const draftOnA = await page.getByRole('textbox', { name: /^Message / }).first().innerText();
  check('a draft on B does not appear in the same-id channel on A', !draftOnA.includes('server B only'),
    `composer on A reads ${JSON.stringify(draftOnA.trim().slice(0, 40))}`);

  // ---- background sync: B keeps up while A is on screen -------------------
  const before = await unreadFor(page, new URL(B.api).host);
  await mention(B.api, seedB, 'background-sync probe on B');
  let after = before;
  for (let i = 0; i < 40 && after <= before; i++) {
    await page.waitForTimeout(1000);
    after = await unreadFor(page, new URL(B.api).host);
  }
  check('a mention on the server *not* on screen raises its switcher badge', after > before,
    `${before} → ${after}`);
  await openSwitcher(page);
  await shot('web-background-unread');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // ---- sign out of A leaves B whole --------------------------------------
  page.once('dialog', (d) => d.accept());
  await openSwitcher(page);
  await dialog.getByRole('button', { name: `Sign out of ${new URL(A.api).host}` }).click();
  await page.waitForTimeout(2500);
  await openSwitcher(page);
  const stillListed = await dialog.getByText(seedB.alice.email).count();
  check('signing out of A leaves B signed in and listed', stillListed > 0);
  const signInRequired = (await dialog.innerText()).includes('Sign in required')
    || (await dialog.innerText()).includes('Not signed in');
  check('A is shown as needing sign-in again', signInRequired);
  await shot('web-after-signout-a');
} catch (e) {
  check('run completed without an unhandled failure', false, String(e).split('\n')[0]);
  await shot('web-failure');
} finally {
  check('no uncaught browser errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
  await browser.close();
}

/** Open the switcher, whether or not it is already open. */
async function openSwitcher(page) {
  const dialog = page.getByRole('dialog', { name: 'Workspaces and servers' });
  if (!(await dialog.count())) {
    await page.getByRole('button', { name: 'Workspaces and servers' }).click();
  }
  await dialog.waitFor({ timeout: 15_000 });
  return dialog;
}

/** Switch the app to the connection whose section names `host`. */
async function selectServer(page, host) {
  const dialog = await openSwitcher(page);
  const section = dialog.locator('section').filter({ hasText: host }).first();
  await section.locator('button').filter({ hasText: /^QA Lab/ }).first().click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
}

/** The switcher's per-server unread badge, read without leaving the page. */
async function unreadFor(page, host) {
  const dialog = await openSwitcher(page);
  const label = await dialog.locator(`[aria-label$="unread on this server"]`).all();
  let value = 0;
  for (const node of label) {
    const section = node.locator('xpath=ancestor::section[1]');
    if ((await section.innerText()).includes(host)) value = Number(await node.innerText()) || 0;
  }
  await dialog.getByRole('button', { name: 'Close' }).click();
  return value;
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
