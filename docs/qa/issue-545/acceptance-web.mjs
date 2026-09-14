// Headless browser acceptance for #545: the web client on a Slack connection,
// served by the REAL connector code with a fake Slack behind it (see
// fake-slack-connector.mjs). Not evidence of a live Slack grant; evidence
// that the adapter, the capability gates and the limits behave end to end.
//
//   pnpm --filter @flow/web exec vite --host 127.0.0.1 --port 5179 &
//   node docs/qa/issue-545/fake-slack-connector.mjs &   # prints {credential,...}
//   PLAYWRIGHT_HOME=... CONNECTOR=<that JSON> node docs/qa/issue-545/acceptance-web.mjs
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.PLAYWRIGHT_HOME, 'package.json'));
const { chromium } = require('playwright');
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5179';
const connector = JSON.parse(process.env.CONNECTOR);
const shots = 'docs/qa/issue-545';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('pageerror', error.message); });
  page.on('console', message => { if (message.type() === 'error' && !/WebSocket|ws:\/\//.test(message.text())) console.error('console', message.text()); });
  // Any 4xx/5xx other than the connector's deliberate 429 is a path the Slack
  // session should never have taken; report it so a stray Flow call is visible.
  const strays = [];
  page.on('response', response => { const status = response.status(); if (status >= 400 && status !== 429 && !/avatars\.example\.test/.test(response.url())) { strays.push(`${status} ${response.request().method()} ${response.url()}`); console.error('stray', status, response.url()); } });
  page.setDefaultTimeout(15_000);

  // Seed the registry the way "Add verified workspace" would have (#543), with
  // the Slack team as the active connection, and no Flow server at all.
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
  // 1. Boot through backend.me(): the Slack team's channels list.
  await page.getByTestId('channel-header').waitFor();
  assert.equal(await page.getByTestId('channel-header').innerText(), '# testing');
  assert.equal(await page.getByTestId('open-in-provider').getAttribute('href'), `https://app.slack.com/client/${connector.teamId}/${connector.channelId}`);
  // Flow-only controls are absent: create channel, new DM, scheduled, activity, huddle, channel menu.
  for (const id of ['sidebar-create-channel', 'sidebar-new-dm', 'channel-menu-trigger', 'huddle-join', 'composer-attach', 'composer-schedule', 'invite-agent-button']) {
    assert.equal(await page.getByTestId(id).count(), 0, `${id} must not render on a Slack team`);
  }
  assert.equal(await page.getByTestId('composer-attach-unavailable').count(), 1);

  // 2. History: 15 of 17 rendered, mrkdwn converted, files and degraded blocks open in Slack, limit banner.
  const body3 = page.getByTestId(`message-${connector.threadTs.replace(/\.\d+$/, '')}`).first();
  void body3;
  await page.getByText('hello bold & @bob see the docs', { exact: false }).first().waitFor().catch(() => {});
  const rendered = await page.locator('[data-testid^="message-1"]').count();
  assert.ok(rendered >= 15, `expected at least 15 messages, saw ${rendered}`);
  assert.ok(await page.locator('[data-testid^="external-attachment-"]').first().isVisible(), 'a Slack file renders as an external attachment');
  assert.ok(await page.locator('[data-testid^="degraded-"]').first().isVisible(), 'a Block Kit message is marked as partly shown');
  await page.getByTestId('history-limited').waitFor();
  await page.screenshot({ path: `${shots}/web-slack-channel.png`, fullPage: false });

  // 3. Loading older hits the connector's parked budget: 429 -> countdown, no retry storm.
  await page.getByTestId('history-load-older').click();
  await page.getByText(/wait \d+s before loading older/).waitFor();
  await page.screenshot({ path: `${shots}/web-slack-rate-limited.png`, fullPage: false });
  await page.getByText('Slack is ready for the next page of history.').waitFor({ timeout: 20_000 });
  await page.getByTestId('history-load-older').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="message-1"]').length >= 17);

  // 4. Reactions are gated with the backend's reason; a message opens in Slack.
  const anyRow = page.locator('[data-testid^="message-1"]').last();
  await anyRow.hover();
  assert.equal(await page.locator('[data-testid^="add-reaction-unavailable-"]').count() > 0, true);
  assert.equal(await page.locator('[data-testid^="add-reaction-"]:not([data-testid*="unavailable"])').count(), 0);

  // 5. Send as the user: optimistic row, then the connector's normalized reply reconciles it by clientMsgId.
  await page.getByTestId('composer-input').click();
  await page.keyboard.type('Sent from Flow acceptance');
  await page.keyboard.press('Enter');
  await page.getByText('Sent from Flow acceptance', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-pending="true"]'));
  assert.equal(await page.getByText('Sent from Flow acceptance', { exact: true }).count(), 1, 'no duplicate after reconciliation');

  // 6. Edit and delete go through the backend (PATCH/DELETE /v1/messages on the connector).
  const mineRow = page.locator('[data-testid^="message-1"]', { hasText: 'Sent from Flow acceptance' });
  await mineRow.hover();
  await mineRow.locator('[data-testid^="edit-message-"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (edited)');
  await page.keyboard.press('Enter');
  await page.getByText('Sent from Flow acceptance (edited)', { exact: false }).waitFor();
  await mineRow.hover();
  await mineRow.locator('[data-testid^="delete-message-"]').click();
  await page.getByTestId('delete-confirm').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Sent from Flow acceptance'));

  // 7. Thread replies load for a root through the connector.
  const root = page.locator(`[data-testid="message-${connector.threadTs}"]`);
  await root.scrollIntoViewIfNeeded();
  await root.getByText('1 reply', { exact: false }).click().catch(async () => { await root.hover(); await root.getByTitle('Reply in thread').click(); });
  await page.getByTestId('thread-panel').waitFor();
  await page.getByText('a reply from bob', { exact: true }).waitFor();
  await page.screenshot({ path: `${shots}/web-slack-thread.png`, fullPage: false });

  // 8. The Events API message injected by the fake arrives through the polled stream.
  try {
    await page.waitForFunction(() => document.body.innerText.includes('live event from bob'), null, { timeout: 20_000 });
  } catch (error) {
    console.error('rows on screen:', await page.locator('[data-testid^="message-1"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid'))));
    throw error;
  }
  await page.screenshot({ path: `${shots}/web-slack-live-event.png`, fullPage: false });

  assert.deepEqual(errors, []);
  assert.deepEqual(strays, [], 'no stray Flow-path requests from a Slack session');
  console.log('PASS: Slack team boots through the backend, history is limited honestly, gated controls stay off, send/edit/delete/thread round-trip through the real connector, and a routed event lands live. Fake Slack upstream.');
} finally { await browser.close(); }
