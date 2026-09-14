import { describe, expect, it } from 'vitest';
import type { ChannelDTO } from '@flow/shared';
import { threadParentLabel } from './channelTitle';

const names = { me: 'Me', a: 'Ada', b: 'Bo' };

const chan = (over: Partial<ChannelDTO>): ChannelDTO =>
  ({
    id: 'c1',
    workspaceId: 'w1',
    name: null,
    kind: 'standard',
    topic: null,
    isPrivate: false,
    createdBy: 'me',
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    isMember: true,
    lastReadMsgId: null,
    unreadCount: 0,
    ...over,
  }) as ChannelDTO;

// #417: what the thread header says after the word "Thread".
describe('threadParentLabel', () => {
  it('names a standard channel with a hash', () => {
    expect(threadParentLabel(chan({ name: 'factory' }), names, 'me')).toEqual({
      connector: 'in',
      name: '#factory',
    });
  });

  it('names a 1:1 DM after the other member', () => {
    expect(threadParentLabel(chan({ kind: 'dm', memberIds: ['me', 'a'] }), names, 'me')).toEqual({
      connector: 'with',
      name: 'Ada',
    });
  });

  it('names a group DM after every other member', () => {
    expect(
      threadParentLabel(chan({ kind: 'group_dm', memberIds: ['b', 'me', 'a'] }), names, 'me'),
    ).toEqual({ connector: 'with', name: 'Ada, Bo' });
  });

  it('names the self-DM after you', () => {
    expect(threadParentLabel(chan({ kind: 'dm', memberIds: ['me'] }), names, 'me')).toEqual({
      connector: 'with',
      name: 'Me (you)',
    });
  });

  it('has nothing to say when the channel is not loaded yet', () => {
    expect(threadParentLabel(undefined, names, 'me')).toBeNull();
  });
});
