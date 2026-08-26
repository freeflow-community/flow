import { describe, expect, it } from 'vitest';
import { UUID, uuidv7 } from 'uuidv7';
import { matchTs, msFromTs, tsFromUuid, uuidBoundForMs } from '../src/slackcompat/ts.js';

function msOfUuid(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/** Compare two derived ts numerically, seconds then fraction (avoids float rounding). */
function cmpTs(a: string, b: string): number {
  const [as, af] = a.split('.').map(Number) as [number, number];
  const [bs, bf] = b.split('.').map(Number) as [number, number];
  return as !== bs ? as - bs : af - bf;
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

  it('lexicographic id order implies strictly increasing ts across milliseconds', () => {
    // The unconditional half of the codec's ordering contract: whenever two ids
    // fall in different milliseconds, id order is ts order. True for any rand_a,
    // so real generator output belongs in this assertion.
    const base = Date.now();
    const ids: string[] = [];
    for (let m = 0; m < 20; m++) {
      for (let a = 0; a < 5; a++) ids.push(v7(base + m, a * 7, a, a));
    }
    // Real generator output lands *inside* the window above on a fast machine,
    // not after it — which is why it is only asserted across ms here (#239).
    ids.push(...Array.from({ length: 50 }, () => uuidv7()));
    const sorted = [...ids].sort();
    let prev: string | null = null;
    for (const id of sorted) {
      if (prev !== null && msOfUuid(id) !== msOfUuid(prev)) {
        expect(cmpTs(tsFromUuid(id), tsFromUuid(prev))).toBeGreaterThan(0);
      }
      prev = id;
    }
  });

  it('within one millisecond ts is weakly monotonic while rand_a stays under 1000', () => {
    // The conditional half: below the fold, id order still implies ts order.
    const ms = Date.now();
    const ids = Array.from({ length: 200 }, (_, i) => v7(ms, i * 5, i, i)); // rand_a 0..995
    const sorted = [...ids].sort();
    let prev: string | null = null;
    for (const id of sorted) {
      if (prev !== null) expect(cmpTs(tsFromUuid(id), tsFromUuid(prev))).toBeGreaterThanOrEqual(0);
      prev = id;
    }
  });

  it('within one millisecond rand_a >= 1000 folds, so a later id can derive a smaller ts', () => {
    // ts.ts documents that rand_a % 1000 folds 4096 values onto 1000, leaving the
    // derived ts only weakly monotonic within one ms. Pin that caveat, so a test
    // asserting more than the codec promises fails here rather than at random.
    const ms = Date.now();
    const earlier = v7(ms, 0x01c); // rand_a 28   -> fraction .028
    const later = v7(ms, 0x7d0); //   rand_a 2000 -> fraction .000
    expect(later > earlier).toBe(true);
    expect(cmpTs(tsFromUuid(later), tsFromUuid(earlier))).toBeLessThan(0);
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
