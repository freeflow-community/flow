import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChannelDTO } from '@flow/shared';
import { MobileNavContext } from '../state';
import { ChannelBrowserList, filterChannels } from './ChannelBrowserView';

const chan = (name: string, extra: Partial<ChannelDTO> = {}): ChannelDTO => ({
  id: `c-${name}`,
  workspaceId: 'w',
  name,
  kind: 'standard',
  topic: null,
  isPrivate: false,
  createdBy: 'u',
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
  isMember: false,
  lastReadMsgId: null,
  unreadCount: 0,
  unreadNotifications: 0,
  unreadThreadRootIds: [],
  notifyLevel: 1,
  parentId: null,
  memberCount: 3,
  ...extra,
});

const names = (list: ChannelDTO[]) => list.map((c) => c.name);

describe('filterChannels', () => {
  it('lists public standard channels, joined or not, sorted by name', () => {
    const list = [
      chan('zeta', { isMember: true }),
      chan('Alpha'),
      chan('secret', { isPrivate: true, isMember: true }),
      chan(null as never, { kind: 'dm', id: 'dm' }),
      chan('beta'),
    ];
    expect(names(filterChannels(list, '', false))).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('searches name and topic, case-insensitively', () => {
    const list = [chan('design'), chan('general', { topic: 'Company-wide DESIGN reviews' }), chan('random')];
    expect(names(filterChannels(list, 'design', false))).toEqual(['design', 'general']);
  });

  it('hides archived channels unless included, then sorts them in place', () => {
    const list = [chan('b-live'), chan('a-old', { archivedAt: '2026-09-02T00:00:00.000Z' }), chan('c-live')];
    expect(names(filterChannels(list, '', false))).toEqual(['b-live', 'c-live']);
    expect(names(filterChannels(list, '', true))).toEqual(['a-old', 'b-live', 'c-live']);
  });
});

describe('ChannelBrowserList render', () => {
  const render = (channels: ChannelDTO[], includeArchived = false, query = '') =>
    renderToStaticMarkup(
      <MobileNavContext.Provider value={{ isMobile: false, drawerOpen: false, openDrawer: () => {}, closeDrawer: () => {} }}>
        <ChannelBrowserList
          channels={channels}
          loading={false}
          query={query}
          onQuery={() => {}}
          includeArchived={includeArchived}
          onIncludeArchived={() => {}}
          joiningId={null}
          onOpen={() => {}}
          onJoin={() => {}}
        />
      </MobileNavContext.Provider>,
    );

  it('offers Join to non-members and marks joined channels, with member counts', () => {
    const html = render([chan('general', { isMember: true, memberCount: 12 }), chan('design', { memberCount: 1 })]);
    expect(html).toContain('channel-browser-join-design');
    expect(html).not.toContain('channel-browser-join-general');
    expect(html).toContain('Joined');
    expect(html).toContain('12 members');
    expect(html).toContain('1 member');
    expect(html).toContain('2 channels');
  });

  it('badges archived channels and never offers to join one', () => {
    const html = render([chan('old', { archivedAt: '2026-09-02T00:00:00.000Z' })], true);
    expect(html).toContain('channel-browser-archived-badge');
    expect(html).not.toContain('channel-browser-join-old');
  });

  it('says so when nothing matches the search', () => {
    expect(render([chan('general')], false, 'zzz')).toContain('No channels match');
  });
});
