import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RailUnreadBadge, unreadLabel } from './RailUnreadBadge';

// The workspace rail badge (#345). The rules worth pinning are the ones a
// reader of the count depends on: zero is silent, and the cap never lets the
// badge grow past three characters.
describe('unreadLabel', () => {
  it('says nothing at zero', () => {
    expect(unreadLabel(0)).toBeNull();
  });

  it('shows a plain number below the cap', () => {
    expect(unreadLabel(1)).toBe('1');
    expect(unreadLabel(42)).toBe('42');
    expect(unreadLabel(99)).toBe('99');
  });

  it('caps at 99+', () => {
    expect(unreadLabel(100)).toBe('99+');
    expect(unreadLabel(4821)).toBe('99+');
  });

  it('treats a missing or nonsense count as nothing to show', () => {
    expect(unreadLabel(-3)).toBeNull();
    expect(unreadLabel(Number.NaN)).toBeNull();
  });
});

describe('RailUnreadBadge', () => {
  const render = (count: number) =>
    renderToStaticMarkup(<RailUnreadBadge count={count} ringColor="#5528A9" testId="rail-unread-acme" />);

  it('renders nothing at zero', () => {
    expect(render(0)).toBe('');
  });

  it('renders the count with a ring in the rail colour', () => {
    const html = render(7);
    expect(html).toContain('rail-unread-acme');
    expect(html).toContain('>7<');
    expect(html).toContain('#5528A9');
  });

  it('renders the cap for a very busy workspace', () => {
    expect(render(1200)).toContain('>99+<');
  });
});
