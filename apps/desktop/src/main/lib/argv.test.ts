import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, isFlowLink, isOpenableExternally } from './argv';

describe('deepLinkFromArgv', () => {
  it('finds the flow:// argument among launcher noise', () => {
    expect(deepLinkFromArgv(['/usr/bin/flow', '--no-sandbox', 'flow://signin?code=abc'])).toBe('flow://signin?code=abc');
    expect(deepLinkFromArgv(['C:\\Flow\\Flow.exe', 'flow://invite/tok'])).toBe('flow://invite/tok');
  });
  it('returns null when there is none, and ignores other schemes and paths', () => {
    expect(deepLinkFromArgv(['/usr/bin/flow'])).toBeNull();
    expect(deepLinkFromArgv(['/usr/bin/flow', 'https://app.freeflow.im', '/tmp/flow://x'])).toBeNull();
    expect(isFlowLink('flow://')).toBe(false);
    expect(isFlowLink('flow://signin with space')).toBe(false);
  });
});

describe('isOpenableExternally', () => {
  it('allows web and mail links only', () => {
    expect(isOpenableExternally('https://example.com/x')).toBe(true);
    expect(isOpenableExternally('http://127.0.0.1:8787/')).toBe(true);
    expect(isOpenableExternally('mailto:a@b.c')).toBe(true);
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'flow://signin', 'app://flow/', 'not a url']) {
      expect(isOpenableExternally(bad)).toBe(false);
    }
  });
});
