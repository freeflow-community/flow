// Semver ordering for the startup staleness check (isOutdated).
import { describe, expect, it } from 'vitest';
import { isOutdated } from '../src/version.js';

describe('isOutdated', () => {
  it('is true only when latest is strictly newer', () => {
    expect(isOutdated('0.4.0', '0.5.1')).toBe(true);
    expect(isOutdated('0.4.0', '0.4.1')).toBe(true);
    expect(isOutdated('0.4.0', '1.0.0')).toBe(true);
    expect(isOutdated('0.9.9', '1.0.0')).toBe(true);
  });

  it('is false when equal or ahead', () => {
    expect(isOutdated('0.4.0', '0.4.0')).toBe(false);
    expect(isOutdated('0.5.0', '0.4.9')).toBe(false);
    expect(isOutdated('1.0.0', '0.9.9')).toBe(false);
  });

  it('ignores prerelease/build metadata and leading v', () => {
    expect(isOutdated('0.4.0', 'v0.5.0')).toBe(true);
    expect(isOutdated('0.4.0', '0.4.0-beta.1')).toBe(false);
    expect(isOutdated('0.4.0-rc.1', '0.4.1')).toBe(true);
  });

  it('is false (fail safe) on unparseable input', () => {
    expect(isOutdated('0.4.0', 'not-a-version')).toBe(false);
    expect(isOutdated('garbage', '9.9.9')).toBe(false);
  });
});
