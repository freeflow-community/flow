import { describe, expect, it } from 'vitest';

import { randomUuid } from './uuid';

describe('randomUuid', () => {
  it('generates distinct RFC 4122 version 4 UUIDs', () => {
    const first = randomUuid();
    const second = randomUuid();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).not.toBe(first);
  });

  it('does not require crypto.randomUUID', () => {
    expect(randomUuid()).toHaveLength(36);
  });
});
