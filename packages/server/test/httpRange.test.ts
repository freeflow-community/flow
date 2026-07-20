// Range parsing behind GET /v1/files/:id (ui_nits: video seeking).
import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../src/lib/httpRange.js';

describe('parseByteRange', () => {
  const len = 1000;

  it('serves full body when the header is absent or malformed', () => {
    expect(parseByteRange(undefined, len)).toBeNull();
    expect(parseByteRange('', len)).toBeNull();
    expect(parseByteRange('bytes=', len)).toBeNull();
    expect(parseByteRange('bytes=a-b', len)).toBeNull();
    expect(parseByteRange('items=0-1', len)).toBeNull();
    // multi-range: RFC 9110 lets us ignore it and send 200
    expect(parseByteRange('bytes=0-1,5-9', len)).toBeNull();
  });

  it('parses start-end inclusive', () => {
    expect(parseByteRange('bytes=0-499', len)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange('bytes=500-999', len)).toEqual({ start: 500, end: 999 });
  });

  it('clamps end past the body length', () => {
    expect(parseByteRange('bytes=900-5000', len)).toEqual({ start: 900, end: 999 });
  });

  it('parses open-ended and suffix forms', () => {
    expect(parseByteRange('bytes=200-', len)).toEqual({ start: 200, end: 999 });
    expect(parseByteRange('bytes=-100', len)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', len)).toEqual({ start: 0, end: 999 }); // suffix > length
  });

  it('flags unsatisfiable ranges for a 416', () => {
    expect(parseByteRange('bytes=1000-', len)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=1500-1600', len)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=500-400', len)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', len)).toBe('unsatisfiable');
  });
});
