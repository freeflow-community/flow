import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EDGE_PX,
  hasAlphaPixels,
  planImagePrep,
  prepareImageForUpload,
  renameFor,
  scaledSize,
  shouldInspect,
} from './imagePrep';

// #243 is a parity ticket: these mirror apps/macos/Tests/FlowTests/ImagePrepTests.swift
// case for case, so the two clients can't drift on the rule.

describe('planImagePrep — resize', () => {
  it('caps the longest edge of an oversized landscape shot', () => {
    expect(planImagePrep('image/jpeg', 4032, 3024)).toEqual({ targetEdge: MAX_EDGE_PX });
  });

  it('caps height, not width, on a portrait shot', () => {
    const plan = planImagePrep('image/jpeg', 3024, 4032);
    expect(plan).toEqual({ targetEdge: MAX_EDGE_PX });
    const size = scaledSize(3024, 4032, plan!.targetEdge);
    expect(size.height).toBe(MAX_EDGE_PX);
    expect(size.width).toBeLessThan(MAX_EDGE_PX);
  });

  it('keeps the aspect ratio', () => {
    const size = scaledSize(4032, 3024, MAX_EDGE_PX);
    expect(size).toEqual({ width: 1024, height: 768 });
  });
});

describe('planImagePrep — passthrough', () => {
  it('leaves a small JPEG untouched', () => {
    expect(planImagePrep('image/jpeg', 800, 600)).toBeNull();
  });

  it('leaves a small PNG untouched', () => {
    expect(planImagePrep('image/png', 400, 400)).toBeNull();
  });

  it('treats exactly 1024px as within the cap', () => {
    expect(planImagePrep('image/jpeg', 1024, 700)).toBeNull();
  });

  it('leaves non-images untouched', () => {
    expect(planImagePrep('application/pdf', 4032, 3024)).toBeNull();
    expect(planImagePrep('video/quicktime', 4032, 3024)).toBeNull();
  });

  it('never touches GIF or SVG, oversized or not', () => {
    expect(shouldInspect('image/gif')).toBe(false);
    expect(shouldInspect('image/svg+xml')).toBe(false);
    expect(planImagePrep('image/gif', 4032, 3024)).toBeNull();
    expect(planImagePrep('image/svg+xml', 4032, 3024)).toBeNull();
  });

  it('ignores a decoder that reported no dimensions', () => {
    expect(planImagePrep('image/jpeg', 0, 0)).toBeNull();
  });
});

describe('planImagePrep — convert', () => {
  it('converts HEIC even when it is already small', () => {
    expect(planImagePrep('image/heic', 600, 400)).toEqual({ targetEdge: 600 });
  });

  it('converts without upscaling', () => {
    const plan = planImagePrep('image/heic', 600, 400)!;
    expect(scaledSize(600, 400, plan.targetEdge)).toEqual({ width: 600, height: 400 });
  });

  it('caps an oversized HEIC as well as converting it', () => {
    expect(planImagePrep('image/heic', 3000, 2000)).toEqual({ targetEdge: MAX_EDGE_PX });
  });

  it('converts other formats the server cannot thumbnail', () => {
    expect(planImagePrep('image/tiff', 500, 500)).toEqual({ targetEdge: 500 });
    expect(planImagePrep('image/bmp', 500, 500)).toEqual({ targetEdge: 500 });
  });

  it('leaves webp alone — the server thumbnails it', () => {
    expect(planImagePrep('image/webp', 900, 900)).toBeNull();
  });
});

describe('hasAlphaPixels', () => {
  it('is false for fully opaque pixels', () => {
    expect(hasAlphaPixels(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
  });

  it('is true when any pixel is not fully opaque', () => {
    expect(hasAlphaPixels(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0]))).toBe(true);
  });
});

describe('renameFor', () => {
  it('swaps the extension rather than appending one', () => {
    expect(renameFor('IMG_4821.heic', 'image/jpeg')).toBe('IMG_4821.jpeg');
    expect(renameFor('logo.tiff', 'image/png')).toBe('logo.png');
  });

  it('keeps dots inside the base name', () => {
    expect(renameFor('scan.v2.heic', 'image/jpeg')).toBe('scan.v2.jpeg');
  });

  it('handles a name with no extension', () => {
    expect(renameFor('clipboard', 'image/jpeg')).toBe('clipboard.jpeg');
  });
});

// The browser half. Vitest runs in node, so createImageBitmap/canvas are
// stubbed — enough to prove the wiring and the fallbacks, not the pixels.
type FakeCanvas = {
  width: number;
  height: number;
  getContext: () => unknown;
  toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
};

function stubBrowser(opts: {
  bitmap?: { width: number; height: number } | 'throws';
  alpha?: boolean;
  blob?: Blob | null;
}): { canvases: FakeCanvas[]; toBlobCalls: Array<{ type: string; quality?: number }> } {
  const canvases: FakeCanvas[] = [];
  const toBlobCalls: Array<{ type: string; quality?: number }> = [];

  vi.stubGlobal('createImageBitmap', async () => {
    if (opts.bitmap === 'throws') throw new Error('unsupported format');
    const { width, height } = opts.bitmap ?? { width: 4032, height: 3024 };
    return { width, height, close: () => {} };
  });

  vi.stubGlobal('document', {
    createElement: () => {
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            // one pixel per position, all opaque unless the test wants alpha
            data: new Uint8ClampedArray(w * h * 4).fill(opts.alpha ? 0 : 255),
          }),
        }),
        toBlob: (cb, type, quality) => {
          toBlobCalls.push({ type, quality });
          cb(opts.blob === undefined ? new Blob(['x'.repeat(100)]) : opts.blob);
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });

  return { canvases, toBlobCalls };
}

const fakeFile = (name: string, type: string, bytes = 1_000_000) =>
  new File([new Uint8Array(bytes)], name, { type });

describe('prepareImageForUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('re-encodes an oversized JPEG to a capped JPEG at 0.85', async () => {
    const { canvases, toBlobCalls } = stubBrowser({ bitmap: { width: 4032, height: 3024 } });
    const out = await prepareImageForUpload(fakeFile('shot.jpg', 'image/jpeg'));

    expect(canvases[0]).toMatchObject({ width: 1024, height: 768 });
    expect(toBlobCalls[0]).toEqual({ type: 'image/jpeg', quality: 0.85 });
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThan(1_000_000);
  });

  it('converts a HEIC to JPEG and renames it', async () => {
    stubBrowser({ bitmap: { width: 3000, height: 2000 } });
    const out = await prepareImageForUpload(fakeFile('IMG_4821.heic', 'image/heic'));

    expect(out.name).toBe('IMG_4821.jpeg');
    expect(out.type).toBe('image/jpeg');
  });

  it('writes PNG, with no quality, when the source has transparency', async () => {
    const { toBlobCalls } = stubBrowser({ bitmap: { width: 2000, height: 2000 }, alpha: true });
    const out = await prepareImageForUpload(fakeFile('logo.png', 'image/png'));

    expect(toBlobCalls[0]).toEqual({ type: 'image/png', quality: undefined });
    expect(out.name).toBe('logo.png');
    expect(out.type).toBe('image/png');
  });

  it('returns the very same File when there is no work to do', async () => {
    stubBrowser({ bitmap: { width: 800, height: 600 } });
    const input = fakeFile('small.jpg', 'image/jpeg');

    expect(await prepareImageForUpload(input)).toBe(input);
  });

  it('returns the original when the browser cannot decode it', async () => {
    stubBrowser({ bitmap: 'throws' });
    const input = fakeFile('IMG_4821.heic', 'image/heic');

    expect(await prepareImageForUpload(input)).toBe(input);
  });

  it('returns the original when the canvas produces no blob', async () => {
    stubBrowser({ bitmap: { width: 4032, height: 3024 }, blob: null });
    const input = fakeFile('shot.jpg', 'image/jpeg');

    expect(await prepareImageForUpload(input)).toBe(input);
  });

  it('does not decode a non-image at all', async () => {
    stubBrowser({ bitmap: 'throws' });
    const input = fakeFile('notes.pdf', 'application/pdf');

    expect(await prepareImageForUpload(input)).toBe(input);
  });
});
