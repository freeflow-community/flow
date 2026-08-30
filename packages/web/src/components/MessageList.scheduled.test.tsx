import { describe, expect, it } from 'vitest';
import type { MessageDTO } from '@flow/shared';
import { showsHeader } from './MessageList';

const msg = (over: Partial<MessageDTO> = {}): MessageDTO => ({
  id: 'm', channelId: 'c1', userId: 'u1', threadRootId: null, clientMsgId: 'cm',
  body: 'hi', createdAt: '2026-01-15T09:00:00.000Z', editedAt: null, deletedAt: null,
  pinnedAt: null, pinnedBy: null, systemKind: null, scheduled: false,
  replyCount: 0, lastReplyAt: null, replyParticipantUserIds: [], reactions: [], files: [], unfurls: [],
  ...over,
});

// The badge lives in the author header, so a scheduled message that merges into
// the author's own preceding message loses it — and then reads as something
// they just typed, which is exactly what the badge exists to deny.
describe('showsHeader with scheduled messages', () => {
  const first = msg({ createdAt: '2026-01-15T09:00:00.000Z' });
  const oneMinuteLater = (over: Partial<MessageDTO>) =>
    msg({ createdAt: '2026-01-15T09:01:00.000Z', ...over });

  it('still groups two ordinary messages from the same author', () => {
    expect(showsHeader([first, oneMinuteLater({})], 1)).toBe(false);
  });

  it('breaks the group when a scheduled message follows a typed one', () => {
    expect(showsHeader([first, oneMinuteLater({ scheduled: true })], 1)).toBe(true);
  });

  it('breaks it in the other direction too', () => {
    const scheduledFirst = msg({ scheduled: true });
    expect(showsHeader([scheduledFirst, oneMinuteLater({})], 1)).toBe(true);
  });

  it('groups consecutive scheduled messages from the same author', () => {
    const scheduledFirst = msg({ scheduled: true });
    expect(showsHeader([scheduledFirst, oneMinuteLater({ scheduled: true })], 1)).toBe(false);
  });
});
