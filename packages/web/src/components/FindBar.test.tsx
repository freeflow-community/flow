import { renderToStaticMarkup } from 'react-dom/server';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import FindBar, { type ChatFind } from './FindBar';

function bar(over: Partial<ChatFind>): string {
  const find: ChatFind = {
    open: true,
    query: '',
    setQuery: () => {},
    total: 0,
    index: -1,
    step: () => {},
    close: () => {},
    inputRef: createRef<HTMLInputElement>(),
    ...over,
  };
  return renderToStaticMarkup(<FindBar find={find} />);
}

describe('FindBar', () => {
  it('shows the 1-based position of the current match', () => {
    expect(bar({ query: 'deploy', total: 4, index: 2 })).toContain('>3/4<');
  });

  it('makes the zero-match state visible rather than silent (AC 6)', () => {
    const html = bar({ query: 'nothing here', total: 0, index: -1 });
    expect(html).toContain('>0/0<');
    // …and the box itself says so, so the counter isn't the only tell.
    expect(html).toContain('border-unread');
  });

  it('disables stepping when there is nothing to step to', () => {
    const html = bar({ query: 'nope', total: 0, index: -1 });
    expect(html.match(/disabled=""/g)).toHaveLength(2); // prev + next
  });

  it('offers a close button beside the counter (AC 5)', () => {
    expect(bar({ query: 'x', total: 1, index: 0 })).toContain('aria-label="Close find"');
  });
});
