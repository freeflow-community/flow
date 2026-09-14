import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowApi } from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());

describe('call file download boundaries', () => {
  const api = new FlowApi('https://flow.invalid', 'test-token');

  it('uses authenticated streaming downloads and forwards call cancellation', async () => {
    const fetchMock = vi.fn(async () => new Response('shared document'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    expect((await api.downloadCallFile('file/id', controller.signal)).toString()).toBe('shared document');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://flow.invalid/v1/files/file%2Fid');
    expect(init.headers).toEqual({ authorization: 'Bearer test-token' });
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('rejects oversized streamed bytes even when the server claims a tiny file', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-length': '1' } })));
    await expect(api.downloadCallFile('file', new AbortController().signal)).rejects.toThrow('20 MB');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('does not treat an inaccessible attachment as document content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'No file access' } }), { status: 403 })));
    await expect(api.downloadCallFile('file', new AbortController().signal)).rejects.toThrow('No file access');
  });
});
