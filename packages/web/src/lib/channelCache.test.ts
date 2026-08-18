import { describe, expect, it } from 'vitest';
import type { ChannelDTO } from '@flow/shared';
import { applyIndicator } from './channelCache';

const chan = (id: string, indicator?: ChannelDTO['indicator']): ChannelDTO => ({
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
  unreadThreadRootIds: [],
  notifyLevel: 1,
  parentId: null,
  ...(indicator !== undefined ? { indicator } : {}),
});

describe('applyIndicator', () => {
  it('turns the spinner on for the named channel only', () => {
    const out = applyIndicator([chan('a'), chan('b')], { channelId: 'a', state: 'busy' });
    expect(out.map((c) => c.indicator ?? null)).toEqual(['busy', null]);
  });

  it('turns it back off', () => {
    const out = applyIndicator([chan('a', 'busy')], { channelId: 'a', state: null });
    expect(out[0]!.indicator).toBeNull();
  });

  it('keeps the same array when the channel is unknown', () => {
    // Events arrive for channels this client may not have loaded yet.
    const list = [chan('a')];
    expect(applyIndicator(list, { channelId: 'gone', state: 'busy' })).toBe(list);
  });

  it('keeps the same array when the state already matches', () => {
    // Identity matters: a new array re-renders the whole sidebar for nothing.
    const list = [chan('a', 'busy')];
    expect(applyIndicator(list, { channelId: 'a', state: 'busy' })).toBe(list);
    const off = [chan('a')];
    expect(applyIndicator(off, { channelId: 'a', state: null })).toBe(off);
  });

  it('does not mutate the channel it replaces', () => {
    const original = chan('a');
    applyIndicator([original], { channelId: 'a', state: 'busy' });
    expect(original.indicator ?? null).toBeNull();
  });
});
