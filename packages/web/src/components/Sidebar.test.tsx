import { describe, expect, it } from 'vitest';
import type { ChannelDTO } from '@flow/shared';
import { nestChannels } from './Sidebar';

// Sub-channel display order (#118). The rule that matters is the fallback: a
// child whose parent isn't in the list must still be rendered, or you lose a
// channel you belong to.
const chan = (id: string, parentId: string | null = null): ChannelDTO => ({
  id,
  workspaceId: 'w1',
  name: id,
  kind: 'standard',
  topic: null,
  isPrivate: false,
  createdBy: 'u1',
  createdAt: '2026-07-29T00:00:00Z',
  archivedAt: null,
  isMember: true,
  lastReadMsgId: null,
  unreadCount: 0,
  unreadNotifications: 0,
  notifyLevel: 1,
  parentId,
});

const shape = (list: ChannelDTO[]) => nestChannels(list).map((r) => `${r.nested ? '  ' : ''}${r.channel.id}`);

describe('nestChannels', () => {
  it('leaves a flat list alone', () => {
    expect(shape([chan('alpha'), chan('beta')])).toEqual(['alpha', 'beta']);
  });

  it('puts a child directly under its parent, indented', () => {
    expect(shape([chan('alpha'), chan('zeta', 'alpha')])).toEqual(['alpha', '  zeta']);
  });

  it('pulls a child up to its parent regardless of input position', () => {
    // The server sorts by name, so a child usually arrives nowhere near its
    // parent — this is the ordinary case, not an edge case.
    expect(shape([chan('alpha'), chan('beta'), chan('gamma', 'alpha')])).toEqual(['alpha', '  gamma', 'beta']);
  });

  it('keeps several children under one parent, in input order', () => {
    expect(shape([chan('alpha'), chan('one', 'alpha'), chan('two', 'alpha')])).toEqual([
      'alpha',
      '  one',
      '  two',
    ]);
  });

  it('renders a child at top level when its parent is not in the list', () => {
    // You can be a member of a child without being in its parent, and the
    // parent may be archived. Either way the channel must not vanish.
    expect(shape([chan('orphan', 'not-here')])).toEqual(['orphan']);
  });

  it('never nests deeper than one level', () => {
    // The server rejects grandchildren. One arriving anyway falls back to top
    // level — the first version of this dropped it from the sidebar entirely.
    expect(shape([chan('alpha'), chan('kid', 'alpha'), chan('grandkid', 'kid')])).toEqual([
      'alpha',
      '  kid',
      'grandkid',
    ]);
  });

  it('returns every channel it was given', () => {
    const list = [chan('a'), chan('b', 'a'), chan('c', 'gone'), chan('d')];
    expect(nestChannels(list)).toHaveLength(list.length);
  });
});
