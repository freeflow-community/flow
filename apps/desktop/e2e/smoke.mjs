// Local smoke run of the desktop shell (docs/specs/desktop-electron.md,
// "Verification"). Not wired into CI. Drives the real Electron binary with
// Playwright over CDP — no synthetic OS input, so it does not touch the
// desktop — against a Flow server that already has the fixture user below.
//
//   FLOW_SERVER_URL=http://127.0.0.1:8787 node e2e/smoke.mjs
//
// It signs in with a password, lands in a workspace, checks the bridge and
// that no bearer reached localStorage, delivers a flow:// link through the
// same path the OS uses, and writes screenshots next to this file.
import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'shots');
mkdirSync(shots, { recursive: true });

const server = process.env.FLOW_SERVER_URL ?? 'http://127.0.0.1:8787';
const email = process.env.FLOW_QA_EMAIL ?? 'desktop-qa@example.test';
const password = process.env.FLOW_QA_PASSWORD ?? 'password123';
const profile = `smoke-${Date.now().toString(36)}`;

const app = await electron.launch({
  args: [root],
  env: { ...process.env, FLOW_SERVER_URL: server, FLOW_PROFILE: profile, FLOW_DESKTOP_TEST_HOOKS: '1' },
});
try {
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('[renderer error]', m.text()); });
  await page.waitForLoadState('domcontentloaded');

  // The bridge is there, typed, and points at the server we asked for.
  const info = await page.evaluate(() => window.flowDesktop?.info ?? null);
  assert.ok(info, 'window.flowDesktop is exposed');
  assert.equal(info.defaultServerOrigin, server);
  assert.equal(info.profile, profile);
  assert.equal(await page.evaluate(() => location.origin), 'app://flow');
  await page.waitForFunction(() => document.title.includes('@'), null, { timeout: 10_000 });
  assert.equal(await page.title(), `Flow — ${profile} @ ${server.replace(/^https?:\/\//, '')}`);
  console.log('bridge ok', info);

  // Sign in with a password, inside the app.
  await page.getByTestId('auth-email').waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(shots, '1-signin.png') });
  // No "open the desktop app" pitch inside the desktop app.
  assert.equal(await page.getByTestId('download-mac-app').count(), 0);
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();

  // First run: no workspace yet — create one; later runs land in it.
  const chooser = page.getByRole('button', { name: /Create Workspace/ });
  const list = page.getByTestId('message-list');
  await Promise.race([chooser.waitFor({ timeout: 20_000 }), list.waitFor({ timeout: 20_000 })]);
  if (await chooser.count()) {
    await page.screenshot({ path: path.join(shots, '2-chooser.png') });
    assert.equal(await page.getByTestId('open-in-app').count(), 0, 'no open-in-app button on desktop');
    const existing = page.locator('[data-testid^="workspace-"]:not([data-testid^="workspace-invit"]):not([data-testid^="workspace-elsewhere"])').first();
    if (await existing.count()) {
      await existing.click();
    } else {
      await chooser.click();
      await page.getByTestId('create-ws-name').fill('Desktop Smoke');
      await page.getByTestId('create-ws-submit').click();
    }
  }
  await list.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: path.join(shots, '3-workspace.png') });
  console.log('signed in and in a workspace');

  // The bearer went to the OS store, not localStorage.
  const leaked = await page.evaluate(() => Object.keys(localStorage).filter(k => k === 'flow.token' || k.endsWith('.token')));
  assert.deepEqual(leaked, [], 'no token key in localStorage');
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const secretsFile = path.join(userData, 'secrets.json');
  assert.ok(existsSync(secretsFile), `secrets.json written at ${secretsFile}`);
  const stored = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const [ref, blob] = Object.entries(stored)[0] ?? [];
  assert.ok(ref && blob && !blob.includes('.'), 'stored value is ciphertext, not a bearer');
  console.log('credential stored encrypted under', ref);

  // A flow:// link delivered the way macOS delivers it reaches the app.
  await page.evaluate(() => {
    window.__links = [];
    window.addEventListener('flow:deeplink', e => window.__links.push(e.detail));
  });
  await app.evaluate(({ app }) => { app.emit('open-url', { preventDefault() {} }, 'flow://invite/smoke-token'); });
  await page.waitForFunction(() => window.__links.length > 0, null, { timeout: 5_000 });
  assert.deepEqual(await page.evaluate(() => window.__links), [{ kind: 'invite', token: 'smoke-token' }]);
  console.log('deep link routed');

  // A new-window request never becomes a second Electron window. (A refused
  // scheme is used so the smoke does not also pop the system browser.)
  const before = (await app.windows()).length;
  await page.evaluate(() => { window.open('file:///never-opened', '_blank'); });
  await page.waitForTimeout(500);
  assert.equal((await app.windows()).length, before, 'window.open did not create an Electron window');

  // Banners go through the shell, one per id, and a click comes back with
  // its routing. Recorded rather than shown (FLOW_DESKTOP_TEST_HOOKS).
  await page.evaluate(() => {
    window.__clicks = [];
    window.flowDesktop.notifications.onClick(r => window.__clicks.push(r));
    const routing = { routingId: 'conn-1', workspaceId: 'w1', channelId: 'c1', messageId: 'm1', threadRootId: null, notificationId: 'n1' };
    window.flowDesktop.notifications.show({ id: 'n1', title: 'Alice (DM)', subtitle: '#general', body: 'hi', silent: false, routing });
    window.flowDesktop.notifications.show({ id: 'n1', title: 'Alice (DM)', body: 'hi again', silent: false, routing });
  });
  await page.waitForTimeout(300);
  const shown = await app.evaluate(() => globalThis.__flowDesktopTest.notifications.map(n => ({ id: n.id, title: n.title, subtitle: n.subtitle })));
  assert.deepEqual(shown, [{ id: 'n1', title: 'Alice (DM)', subtitle: '#general' }], 'one banner per id');
  await app.evaluate(() => globalThis.__flowDesktopTest.click('n1'));
  await page.waitForFunction(() => window.__clicks.length > 0, null, { timeout: 5_000 });
  assert.equal((await page.evaluate(() => window.__clicks))[0].notificationId, 'n1');
  console.log('banner shown once and click routed');

  // The badge reaches the OS (the Dock count on macOS).
  await page.evaluate(() => window.flowDesktop.badge.set(3));
  await page.waitForTimeout(300);
  if (process.platform === 'darwin') assert.equal(await app.evaluate(({ app }) => app.getBadgeCount()), 3, 'dock badge');
  await page.evaluate(() => window.flowDesktop.badge.set(0));
  await page.waitForTimeout(300);
  if (process.platform === 'darwin') assert.equal(await app.evaluate(({ app }) => app.getBadgeCount()), 0, 'dock badge cleared');
  console.log('badge ok');

  console.log('SMOKE OK');
} catch (error) {
  // Leave evidence of where it stopped.
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(shots, 'error.png') });
    console.log('[page text]', (await page.evaluate(() => document.body.innerText)).slice(0, 1500));
  } catch { /* the window is gone */ }
  throw error;
} finally {
  await app.close();
}
