// Headless browser contract test. Slack/connector HTTP responses are simulated;
// this is NOT evidence of a live Slack grant. Run a Vite preview with
// VITE_SLACK_CONNECTOR_ORIGIN=https://connector.test on WEB_ORIGIN (default below).
// PLAYWRIGHT_HOME must contain an installed playwright package.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.PLAYWRIGHT_HOME, 'package.json'));
const { chromium } = require('playwright');
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5179';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.setDefaultTimeout(10_000);
  let team = 1, operationId;
  const sessions = [];
  const deleted = [];
  await context.route('https://connector.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
    const json = body => route.fulfill({ json: body, headers });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/v1/oauth/start') {
      operationId = `operation-${team}`;
      return json({ operationId, authorizationUrl: `https://slack.com/oauth/v2/authorize?state=test-${team}` });
    }
    if (path === '/oauth/callback') return route.fulfill({ contentType: 'text/html', body: `<script>window.opener.postMessage({type:'flow-slack-handoff',operationId:${JSON.stringify(operationId)},handoff:'test-handoff'},${JSON.stringify(origin)})</script>` });
    if (path === '/v1/oauth/exchange') {
      const body = request.postDataJSON();
      assert.equal(body.operationId, operationId);
      assert.match(body.verifier, /^[A-Za-z0-9_-]{43}$/);
      const result = { credential: `connector-session-${team}`, status: 'connected', identity: { environment: 'slack', enterpriseId: null, teamId: `T${team}`, userId: 'U1' }, grantId: `grant-${team}`, teamName: `Test team ${team}`, userName: 'Alice', scopes: ['chat:write'], capabilities: { sendAsUser: true }, grantStatus: 'active' };
      sessions.push(result); team++;
      return json(result);
    }
    if (path === '/v1/events') return json({ events: [] });
    if (path === '/v1/session') { deleted.push(request.headers().authorization); return json({ ok: true }); }
    if (path === '/v1/connection') return json(sessions.find(s => `Bearer ${s.credential}` === request.headers().authorization));
    throw new Error(`Unexpected connector request ${path}`);
  });
  await context.route('https://slack.com/oauth/v2/authorize**', route => route.fulfill({ status: 302, headers: { location: 'https://connector.test/oauth/callback' } }));
  await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
await import('/src/index.css');
const React=(await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {default:Connections}=await import('/src/components/ServerConnections.tsx');
createRoot(document.getElementById('root')).render(React.createElement(Connections,{onClose:()=>{},onSelect:()=>{}}));
</script>` }));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Connect Slack', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Slack connector URL' }).count(), 0);
  for (let index = 1; index <= 2; index++) {
    await page.getByRole('button', { name: 'Connect Slack', exact: true }).click();
    await page.getByRole('button', { name: 'Add verified workspace' }).waitFor();
    assert.ok(await page.getByText(`Test team ${index}`, { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Add verified workspace' }).click();
    await page.getByText(`Slack · Test team ${index} · Alice`, { exact: true }).waitFor();
  }
  const registry = await page.evaluate(() => JSON.parse(localStorage.getItem('flow.connections')));
  assert.equal(registry.connections.filter(c => c.provider === 'flow').length, 1);
  assert.equal(registry.connections.filter(c => c.provider === 'slack').length, 2);
  assert.notEqual(registry.connections[1].providerIdentity, registry.connections[2].providerIdentity);
  assert.ok(!JSON.stringify(registry).includes('connector-session'));
  mkdirSync('docs/qa/issue-543', { recursive: true });
  await page.screenshot({ path: 'docs/qa/issue-543/web-two-teams.png', fullPage: true });
  await page.getByRole('button', { name: 'Disconnect this client' }).first().click();
  await page.getByText('Slack · Test team 1 · Alice', { exact: true }).waitFor({ state: 'detached' });
  assert.ok(await page.getByText('Slack · Test team 2 · Alice', { exact: true }).isVisible());
  assert.deepEqual(deleted, ['Bearer connector-session-1']);
  assert.deepEqual(errors, []);
  console.log('PASS: one-click OAuth, verified review, two distinct Slack teams alongside Flow, isolated disconnect. Simulated upstream.');
} finally { await browser.close(); }
