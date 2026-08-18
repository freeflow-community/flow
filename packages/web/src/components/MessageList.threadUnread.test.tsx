import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDTO } from '@flow/shared';

// #270: the sidebar badge says *a* thread reply needs you; the dot on the
// reply chip says *which* thread. Without it the only way to find the thread
// was the Activity feed — and for a thread with no affordance at all, nothing.
vi.mock('../state', () => ({
  useAuth: () => ({ user: { id: 'u-me' }, token: 't' }),
  useSelection: () => ({ workspaceId: 'w1', channelId: 'c1', threadRootId: null, openThread: () => {} }),
  InlineLinkContext: { Provider: ({ children }: { children: unknown }) => children },
}));
vi.mock('../hooks', () => ({
  useSendMessage: () => ({ mutate: () => {} }),
  useTogglePin: () => ({ mutate: () => {} }),
  useToggleReaction: () => ({ mutate: () => {} }),
  useWorkspaceEmojiMap: () => ({}),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => {} }) }));

const MessageList = (await import('./MessageList')).default;

const root = (id: string): MessageDTO => ({
  id,
  channelId: 'c1',
  userId: 'u-other',
  threadRootId: null,
  clientMsgId: id,
  body: 'a message with replies',
  createdAt: '2026-08-17T10:00:00Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  pinnedBy: null,
  replyCount: 2,
  lastReplyAt: '2026-08-17T10:05:00Z',
  systemKind: null,
  replyParticipantUserIds: [],
  reactions: [],
  files: [],
  unfurls: [],
});

function render(unreadThreadRootIds: string[]): string {
  return renderToStaticMarkup(
    <MessageList
      messages={[root('m1')]}
      names={{ 'u-other': 'Other' }}
      hasMore={false}
      onLoadOlder={() => {}}
      showThreadAffordances
      unreadThreadRootIds={unreadThreadRootIds}
    />,
  );
}

describe('reply chip unread dot', () => {
  it('marks the chip when the thread holds an unread notification for me', () => {
    const html = render(['m1']);
    expect(html).toContain('data-testid="thread-unread-m1"');
    expect(html).toContain('data-thread-unread="true"');
  });

  it('leaves the chip plain when nothing in the thread is unread', () => {
    const html = render([]);
    expect(html).toContain('data-testid="thread-open-m1"'); // the chip is still there
    expect(html).not.toContain('data-testid="thread-unread-m1"');
    expect(html).not.toContain('data-thread-unread');
  });

  it('does not mark this thread for an unread reply in a different one', () => {
    expect(render(['some-other-root'])).not.toContain('data-testid="thread-unread-m1"');
  });
});
