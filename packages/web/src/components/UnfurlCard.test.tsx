import { describe, expect, it } from 'vitest';
import { formatDuration } from './UnfurlCard';

// The runtime pill on a video card (#302). The server sends seconds; anything
// it couldn't determine is absent, and an absent duration must render nothing
// rather than "0:00".
describe('formatDuration', () => {
  it('formats as m:ss, padding the seconds', () => {
    expect(formatDuration(214)).toBe('3:34');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(1)).toBe('0:01');
  });

  it('grows an hours field only when it needs one', () => {
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('renders nothing for a duration the server did not send', () => {
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
