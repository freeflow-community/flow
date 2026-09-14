import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileImageUrl } from './api';
import { ConnectionManager, __setConnectionManager } from './connectionRuntime';

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe('fileImageUrl', () => {
  // Requests now resolve against the *owning connection's* origin rather than
  // the page's, so the URLs below are absolute on that backend.
  const ORIGIN = 'https://flow.example.com';

  beforeEach(() => {
    const store = new Map<string, string>([['flow.token', 'test-token']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    __setConnectionManager(new ConnectionManager(ORIGIN));
  });

  afterEach(() => {
    __setConnectionManager(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hands a direct access-checked thumbnail URL to the image element', async () => {
    const fetchMock = vi.fn(async () => okJson({
      url: 'https://objects.example/thumb.webp?signed=1',
      expiresInSeconds: 300,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fileImageUrl('f-direct', 'thumbnail')).resolves.toBe(
      'https://objects.example/thumb.webp?signed=1',
    );
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/v1/files/f-direct/thumb/url`, expect.objectContaining({
      credentials: 'omit',
      headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
    }));
  });

  it('falls back to an authenticated object URL when storage cannot presign', async () => {
    const blob = new Blob(['image-bytes'], { type: 'image/webp' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ url: null, expiresInSeconds: 0 }))
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');

    await expect(fileImageUrl('f-local', 'thumbnail')).resolves.toBe('blob:local-preview');
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${ORIGIN}/v1/files/f-local/thumb`, expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
    }));
  });

  it('surfaces a direct-URL network failure to the visible attachment error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fileImageUrl('f-offline', 'thumbnail')).rejects.toThrow('offline');
  });

  it('surfaces object-URL creation failure instead of leaving a permanent loader', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ url: null, expiresInSeconds: 0 }))
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('object URL unavailable'); });

    await expect(fileImageUrl('f-object-url', 'thumbnail')).rejects.toThrow('object URL unavailable');
  });

  it('uses the longer-lived original-file URL for lightboxes and GIFs', async () => {
    const fetchMock = vi.fn(async () => okJson({
      url: 'https://objects.example/original.gif?signed=1',
      expiresInSeconds: 3600,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fileImageUrl('f-gif', 'original')).resolves.toContain('original.gif');
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/v1/files/f-gif/url`, expect.any(Object));
  });
});
