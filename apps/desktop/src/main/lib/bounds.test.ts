import { describe, expect, it } from 'vitest';
import { isVisibleOn, parseWindowState, restoreBounds } from './bounds';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

describe('parseWindowState', () => {
  it('accepts only a complete numeric record', () => {
    expect(parseWindowState('{"x":10,"y":20,"width":800,"height":600,"maximized":true}')).toEqual({ x: 10, y: 20, width: 800, height: 600, maximized: true });
    expect(parseWindowState('{"x":10,"y":20,"width":800}')).toBeNull();
    expect(parseWindowState('{"x":"10","y":20,"width":800,"height":600}')).toBeNull();
    expect(parseWindowState('garbage')).toBeNull();
    expect(parseWindowState(null)).toBeNull();
  });
});

describe('restoreBounds', () => {
  it('keeps a saved window that is still on a display', () => {
    const saved = { x: 100, y: 100, width: 1000, height: 700, maximized: false };
    expect(restoreBounds(saved, [primary, second], primary)).toEqual({ x: 100, y: 100, width: 1000, height: 700 });
    const onSecond = { ...saved, x: 2000 };
    expect(restoreBounds(onSecond, [primary, second], primary)).toEqual({ x: 2000, y: 100, width: 1000, height: 700 });
  });
  it('falls back to a centred default when the display went away or the size is absurd', () => {
    const onSecond = { x: 2000, y: 100, width: 1000, height: 700, maximized: false };
    expect(isVisibleOn(onSecond, [primary])).toBe(false);
    expect(restoreBounds(onSecond, [primary], primary)).toEqual({ x: 360, y: 140, width: 1200, height: 800 });
    expect(restoreBounds({ x: 0, y: 0, width: 100, height: 50, maximized: false }, [primary], primary)).toEqual({ x: 360, y: 140, width: 1200, height: 800 });
    expect(restoreBounds(null, [primary], primary)).toEqual({ x: 360, y: 140, width: 1200, height: 800 });
  });
  it('never opens larger than the primary display', () => {
    const small = { x: 0, y: 0, width: 1024, height: 640 };
    expect(restoreBounds(null, [small], small)).toEqual({ x: 0, y: 0, width: 1024, height: 640 });
  });
});
