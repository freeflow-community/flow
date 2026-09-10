import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSignIn } from './authHandoff';

afterEach(() => vi.unstubAllGlobals());

describe('browser sign-in cancellation', () => {
  it('closes the popup without sending credentials when already canceled', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const popup = { close: vi.fn() } as unknown as Window;
    const controller = new AbortController();
    controller.abort();
    await expect(browserSignIn('https://other.example', popup, controller.signal)).rejects.toThrow('canceled');
    expect(popup.close).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('closes the popup if the issuing server rejects handoff creation', async () => {
    vi.stubGlobal('location', { origin: 'https://client.example' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'Return origin is not allowed' } }), { status: 403 },
    )));
    const popup = { close: vi.fn() } as unknown as Window;
    await expect(browserSignIn('https://other.example', popup, new AbortController().signal))
      .rejects.toThrow('Return origin is not allowed');
    expect(popup.close).toHaveBeenCalledOnce();
  });
});
