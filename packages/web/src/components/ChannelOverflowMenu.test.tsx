import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChannelOverflowMenu from './ChannelOverflowMenu';

const render = () =>
  renderToStaticMarkup(
    <ChannelOverflowMenu
      artifacts={[]}
      pinCount={3}
      showOptions
      onOpenFiles={() => {}}
      onOpenPins={() => {}}
      onOpenArtifact={() => {}}
      onOpenOptions={() => {}}
      onClose={() => {}}
    />,
  );

describe('ChannelOverflowMenu', () => {
  it('puts Files first, above pinned messages (#347)', () => {
    const html = render();
    expect(html).toContain('channel-menu-files');
    expect(html.indexOf('channel-menu-files')).toBeLessThan(html.indexOf('channel-menu-pins'));
  });
});
