// Headless browser acceptance for #546: the web client on a Slack connection
// served by the REAL connector code with a fake Slack behind it (see
// fake-slack-connector.mjs). Covers the step-4 promises: an unknown send
// outcome reconciles on retry and never posts twice; out-of-order and
// malformed events land in ts order with the bad one dropped; a truncated
// transcript says where the rest lives; notifications read as limited.
//
//   pnpm --filter @flow/web exec vite --host 127.0.0.1 --port 5180 &
//   node docs/qa/issue-546/fake-slack-connector.mjs &   # prints {credential,...}
//   PLAYWRIGHT_HOME=... CONNECTOR=<that JSON> node docs/qa/issue-546/acceptance-web.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.PLAYWRIGHT_HOME, 'package.json'));
const { chromium } = require('playwright');
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5180';
const connector = JSON.parse(process.env.CONNECTOR);
const shots = 'docs/qa/issue-546';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('pageerror', error.message); });
  const strays = [];
  // The deliberate failures: the connector's 429 on the parked budget and the
  // 504 send_unknown for the first send. Anything else is a stray.
  page.on('response', response => { const status = response.status(); if (status >= 400 && status !== 429 && status !== 504 && !/avatars\.example\.test/.test(response.url())) { strays.push(`${status} ${response.request().method()} ${response.url()}`); console.error('stray', status, response.url()); } });
  page.setDefaultTimeout(15_000);

  const seed = { origin: connector.origin, credential: connector.credential, teamId: connector.teamId, userId: connector.userId };
  await context.addInitScript((seed) => {
    if (localStorage.getItem('flow.connections')) return;
    const connectionId = 'slack-conn-1', storageKey = 'slackns1';
    const registry = {
      version: 1,
      connections: [{ connectionId, provider: 'slack', providerIdentity: JSON.stringify(['slack', null, seed.teamId, seed.userId]), origin: seed.origin, label: 'Acceptance Team · alice', apiVersion: 1, capabilities: { identity: true, sendAsUser: true, readConversations: true, readHistory: true, liveUpdates: true, lifecycle: true, reactions: false, readState: false, search: false, files: false }, addedAt: new Date().toISOString() }],
      sessions: [{ connectionId, userId: seed.userId, credentialRef: `flow.${storageKey}.token`, storageKey, authGeneration: 0, status: 'authenticated' }],
      bindings: [{ connectionId, userId: seed.userId, workspaceId: seed.teamId, name: 'Acceptance Team', hidden: false }],
      navigation: [], activeConnectionId: connectionId,
    };
    localStorage.setItem('flow.connections', JSON.stringify(registry));
    localStorage.setItem('flow.connections.migrated', JSON.stringify({ version: 1, at: new Date().toISOString() }));
    localStorage.setItem(`flow.${storageKey}.token`, seed.credential);
    localStorage.setItem(`flow.${storageKey}.activeWorkspace`, seed.teamId);
    sessionStorage.setItem('flow.selectedConnection', connectionId);
  }, seed);

  await page.goto(origin);
  await page.getByTestId('channel-header').waitFor();
  assert.equal(await page.getByTestId('channel-header').innerText(), '# testing');
  await page.getByTestId('history-limited').waitFor();

  // 1. Unknown outcome: the first send is stored by Slack but the reply is
  //    lost. The row shows as failed with a Retry; the retry reconciles at the
  //    connector (one history lookup, no second post) and exactly one row remains.
  await page.getByTestId('composer-input').click();
  await page.keyboard.type('Reconcile me');
  await page.keyboard.press('Enter');
  await page.locator('[data-testid^="send-failed-"]').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${shots}/web-slack-send-unknown.png`, fullPage: false });
  await page.locator('[data-testid^="send-failed-"] button', { hasText: 'Retry' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid^="send-failed-"]') && !document.querySelector('[data-pending="true"]'), null, { timeout: 30_000 });
  assert.equal(await page.getByText('Reconcile me', { exact: true }).count(), 1, 'reconciled to exactly one row');
  // Slack's own history (through the connector) holds exactly one copy: the
  // retry reconciled instead of posting again.
  const slackHistory = await fetch(`${connector.origin}/v1/history?channel=${connector.channelId}&limit=15`, { headers: { authorization: `Bearer ${connector.credential}`, origin } }).then(r => r.json());
  assert.equal(slackHistory.messages.filter(m => m.body === 'Reconcile me').length, 1, 'Slack has one copy, not two');

  // 2. Events: two messages delivered out of order around a malformed one.
  //    Both land, in ts order, and the malformed one never breaks the stream.
  await page.waitForFunction(() => document.body.innerText.includes('live event one from bob') && document.body.innerText.includes('live event two from bob'), null, { timeout: 25_000 });
  // The transcript's DOM may run newest-first; what matters is that every
  // row, the two live events included, sits in ts order in one direction.
  const tsOrder = await page.locator('[data-testid^="message-1"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').slice('message-'.length)));
  const ascending = [...tsOrder].sort();
  const descending = [...ascending].reverse();
  assert.ok(tsOrder.join() === ascending.join() || tsOrder.join() === descending.join(), `rows are in ts order, saw ${tsOrder}`);
  assert.ok(tsOrder.includes(connector.liveTs[0]) && tsOrder.includes(connector.liveTs[1]), 'both live events rendered');
  assert.equal(await page.getByText('drift', { exact: true }).count(), 0, 'the malformed event is dropped');
  await page.screenshot({ path: `${shots}/web-slack-events-ordered.png`, fullPage: false });

  // 3. Retention: once the transcript is exhausted it says where the rest lives.
  await page.getByTestId('history-load-older').click();
  await page.getByText('Slack is ready for the next page of history.').waitFor({ timeout: 20_000 });
  await page.getByTestId('history-load-older').click();
  await page.getByTestId('history-end-note').waitFor({ timeout: 20_000 });
  assert.match(await page.getByTestId('history-end-note').innerText(), /Older messages may exist in Slack/);
  await page.screenshot({ path: `${shots}/web-slack-retention-note.png`, fullPage: false });

  assert.deepEqual(errors, []);
  assert.deepEqual(strays, [], 'no stray Flow-path requests from a Slack session');
  console.log('PASS: an unknown send outcome reconciles to one row on retry, out-of-order events render in ts order with the malformed one dropped, and the exhausted transcript points to Slack. Fake Slack upstream.');
} finally { await browser.close(); }
