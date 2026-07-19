import { describe, expect, it } from 'vitest';
import { UUID, uuidv7 } from 'uuidv7';
import { matchTs, msFromTs, tsFromUuid, uuidBoundForMs } from '../src/slackcompat/ts.js';

function msOfUuid(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/** Build a real UUIDv7 via the uuidv7 package with explicit fields. */
function v7(ms: number, randA: number, randBHi = 0x1234_5678 % 2 ** 30, randBLo = 0x9abc_def0 % 2 ** 32): string {
  return UUID.fromFieldsV7(ms, randA, randBHi, randBLo).toString();
}

describe('slack ts codec', () => {
  it('derives seconds.mmm + 3 digits from the 12 bits after the version nibble', () => {
    // 0x0190_1234_5678 ms = 1718292338296 -> 1718292338.296; randA 0x7b = 123
    const id = v7(0x0190_1234_5678, 0x07b);
    expect(tsFromUuid(id)).toBe('1718292338.296123');
    // randA 4095 -> 4095 % 1000 = 095
    expect(tsFromUuid(v7(0x0190_1234_5678, 0xfff))).toBe('1718292338.296095');
  });

  it('round-trips real uuidv7() ids: ms survives, matchTs finds the id', () => {
    const ids = Array.from({ length: 200 }, () => uuidv7());
    for (const id of ids) {
      const ts = tsFromUuid(id);
      expect(ts).toMatch(/^\d+\.\d{6}$/);
      expect(msFromTs(ts)).toBe(msOfUuid(id));
      expect(matchTs([id], ts)).toBe(id);
    }
  });

  it('matchTs resolves the right id among same-millisecond siblings', () => {
    const ms = Date.now();
    const ids = Array.from({ length: 50 }, (_, i) => v7(ms, i * 3, i, i));
    for (const id of ids) {
      expect(matchTs(ids, tsFromUuid(id))).toBe(id);
    }
  });

  it('distinct ids in the same millisecond derive distinct ts (distinct rand_a)', () => {
    const ms = Date.now();
    const ids = Array.from({ length: 100 }, (_, i) => v7(ms, i));
    const tss = new Set(ids.map(tsFromUuid));
    expect(tss.size).toBe(ids.length);
  });

  it('lexicographic id order implies numeric ts order within a channel', () => {
    // strictly increasing across ms; monotone rand_a (< 1000) within one ms
    const base = Date.now();
    const ids: string[] = [];
    for (let m = 0; m < 20; m++) {
      for (let a = 0; a < 5; a++) ids.push(v7(base + m, a * 7, a, a));
    }
    // also mix in real generator output at later timestamps
    ids.push(...Array.from({ length: 50 }, () => uuidv7()));
    const sorted = [...ids].sort();
    const asPair = (ts: string): [number, number] => {
      const [s, f] = ts.split('.');
      return [Number(s), Number(f)];
    };
    let prev: [number, number] = [-1, -1];
    for (const id of sorted) {
      const [s, f] = asPair(tsFromUuid(id));
      expect(s > prev[0] || (s === prev[0] && f >= prev[1])).toBe(true);
      prev = [s, f];
    }
  });

  it('uuidBoundForMs brackets every id of that millisecond', () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      const ms = msOfUuid(id);
      expect(id >= uuidBoundForMs(ms)).toBe(true);
      expect(id < uuidBoundForMs(ms + 1)).toBe(true);
    }
  });

  it('msFromTs rejects malformed or out-of-range ts', () => {
    expect(msFromTs('not-a-ts')).toBeNull();
    expect(msFromTs('123.45')).toBeNull(); // fraction must be 6 digits
    expect(msFromTs('123.4567890')).toBeNull();
    expect(msFromTs('9999999999999.000000')).toBeNull(); // > 48 bits
    expect(msFromTs('1718014129.784123')).toBe(1718014129784);
  });

  it('tsFromUuid rejects non-uuids', () => {
    expect(() => tsFromUuid('nope')).toThrow();
  });
});
