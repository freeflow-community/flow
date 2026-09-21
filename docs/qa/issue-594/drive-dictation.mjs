// Needs `playwright` resolvable from the cwd (e.g. run from apps/desktop, which
// has it as a dev dependency) and a qa:up stack: pass its base URL, a bearer
// token and a workspace id through the environment.
import { chromium } from 'playwright';
const base = process.env.FLOW_QA_BASE ?? 'http://127.0.0.1:8787';
const token = process.env.FLOW_QA_TOKEN ?? '', ws = process.env.FLOW_QA_WORKSPACE ?? '';
if (!token || !ws) throw new Error('set FLOW_QA_TOKEN and FLOW_QA_WORKSPACE');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.addInitScript(() => {
  class FakeSR { constructor() { window.__sr = this; } start() { window.__srStarted = true; } stop() { setTimeout(() => { this.onresult?.(window.__ev(true)); this.onend?.(); }, 50); } abort() { this.onend?.(); } }
  window.__ev = (fin) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: fin, 0: { transcript: 'at noon tomorrow in the design room' } } } });
  window.SpeechRecognition = FakeSR;
});
await page.goto(base + '/');
await page.evaluate(([t, w]) => { localStorage.setItem('flow.token', t); localStorage.setItem('flow.activeWorkspace', w); }, [token, ws]);
await page.goto(base + '/');
const input = page.getByTestId('composer-input');
await input.waitFor({ timeout: 20000 });
await input.click();
await page.keyboard.type('Meet me ');
await page.screenshot({ path: '/tmp/qa594/1-idle.png' });
await page.getByTestId('composer-dictate').click();
await page.evaluate(() => { window.__sr.onstart(); window.__sr.onresult(window.__ev(false)); });
await page.waitForTimeout(150);
const during = await page.evaluate(() => ({
  editable: document.querySelector('[data-testid=composer-input]').isContentEditable,
  send: document.querySelector('[data-testid=composer-send]').disabled,
  emoji: document.querySelector('[data-testid=composer-emoji]').disabled,
  status: document.querySelector('[data-testid=composer-dictation-status]')?.textContent,
  interim: document.querySelector('[data-testid=composer-dictation-interim]')?.textContent,
}));
console.log('during', JSON.stringify(during));
await page.screenshot({ path: '/tmp/qa594/2-listening.png' });
await page.getByTestId('composer-dictate').click();
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  text: document.querySelector('[data-testid=composer-input]').innerText,
  focusTestId: document.activeElement?.getAttribute('data-testid'),
  undo: !!document.querySelector('[data-testid=composer-dictation-undo]'),
  send: document.querySelector('[data-testid=composer-send]').disabled,
  draft: Object.entries(localStorage).filter(([k]) => k.includes('draft')).map(([,v]) => v),
}));
console.log('after', JSON.stringify(after));
await page.screenshot({ path: '/tmp/qa594/3-after-stop.png' });
// Escape + pagehide cancel
await page.getByTestId('composer-dictate').click();
await page.keyboard.press('Escape');
console.log('esc state', await page.evaluate(() => document.querySelector('[data-testid=composer-dictate]').getAttribute('aria-pressed')));
await page.getByTestId('composer-dictation-undo').count().then(n => console.log('undo after new session', n));
await browser.close();
