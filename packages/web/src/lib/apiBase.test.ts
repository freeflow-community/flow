// The apiBase seam (docs/design/ANDROID.md, phase 0). The property that
// matters most is the first one: with nothing configured, every URL is exactly
// the relative path it always was, so the web build cannot have changed
// behaviour. The rest pins down how a packaged client points elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, getApiBase, resetApiBaseForTests, setApiBase, wsUrl } from './apiBase';
import { setStore, store, type KeyValueStore } from './storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => {
      if (v === null) data.delete(k);
      else data.set(k, v);
    },
  };
}

beforeEach(() => {
  setStore(memoryStore());
  resetApiBaseForTests();
  vi.stubEnv('VITE_API_BASE', '');
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8787' });
});

afterEach(() => {
  setStore();
  resetApiBaseForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('same-origin default', () => {
  it('leaves API paths untouched', () => {
    expect(getApiBase()).toBe('');
    expect(apiUrl('/v1/me')).toBe('/v1/me');
  });

  it('derives the socket URL from the page, matching its scheme', () => {
    expect(wsUrl('/v1/ws')).toBe('ws://localhost:8787/v1/ws');
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.freeflow.im' });
    expect(wsUrl('/v1/ws')).toBe('wss://app.freeflow.im/v1/ws');
  });
});

describe('build-time base (VITE_API_BASE)', () => {
  it('prefixes API paths and drops a trailing slash', () => {
    vi.stubEnv('VITE_API_BASE', 'https://app.freeflow.im/');
    expect(getApiBase()).toBe('https://app.freeflow.im');
    expect(apiUrl('/v1/me')).toBe('https://app.freeflow.im/v1/me');
  });

  it('turns http(s) into ws(s) for the socket, ignoring the page', () => {
    vi.stubEnv('VITE_API_BASE', 'https://app.freeflow.im');
    expect(wsUrl('/v1/ws')).toBe('wss://app.freeflow.im/v1/ws');
    vi.stubEnv('VITE_API_BASE', 'http://192.168.1.10:8787');
    expect(wsUrl('/v1/ws')).toBe('ws://192.168.1.10:8787/v1/ws');
  });
});

describe('runtime override (server picker)', () => {
  it('wins over the build-time value and persists through the store', () => {
    vi.stubEnv('VITE_API_BASE', 'https://app.freeflow.im');
    setApiBase('https://flow.example.org/');
    expect(apiUrl('/v1/me')).toBe('https://flow.example.org/v1/me');
    expect(store().get('flow.apiBase')).toBe('https://flow.example.org');

    // A fresh module state (next launch) reads it back from the store.
    resetApiBaseForTests();
    expect(getApiBase()).toBe('https://flow.example.org');
  });

  it('clears back to the build-time value with null', () => {
    vi.stubEnv('VITE_API_BASE', 'https://app.freeflow.im');
    setApiBase('https://flow.example.org');
    setApiBase(null);
    expect(getApiBase()).toBe('https://app.freeflow.im');
    expect(store().get('flow.apiBase')).toBeNull();
  });
});
