import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MemberRole, MessageDTO, WorkspaceMemberDTO } from '@flow/shared';

vi.mock('../state', () => ({
  useAuth: () => ({ user: { id: 'u-me' }, token: 't' }),
  useSelection: () => ({
    workspaceId: 'w1', channelId: 'c1', threadRootId: null,
    editingMessageId: null, openThread: () => {}, setEditingMessage: () => {},
  }),
}));
vi.mock('../hooks', () => ({
  useSendMessage: () => ({ mutate: () => {} }),
  useTogglePin: () => ({ mutate: () => {} }),
  useToggleReaction: () => ({ mutate: () => {} }),
  useWorkspaceEmojiMap: () => ({}),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined, setQueryData: () => {}, removeQueries: () => {}, invalidateQueries: () => Promise.resolve(),
  }),
}));

const MessageList = (await import('./MessageList')).default;

function member(userId: string, role: MemberRole, over: Partial<WorkspaceMemberDTO> = {}): WorkspaceMemberDTO {
  return {
    userId,
    displayName: userId,
    email: `${userId}@example.test`,
    privacyMode: false,
    avatarUrl: null,
    statusEmoji: '',
    statusText: '',
    title: '',
    isAgent: false,
    isBot: false,
    sponsorId: null,
    role,
    joinedAt: '2026-08-27T00:00:00.000Z',
    ...over,
  };
}

function message(over: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 'm1', channelId: 'c1', userId: 'u-other', threadRootId: null,
    clientMsgId: 'cm1', body: 'bot output', createdAt: '2026-08-27T00:00:00.000Z',
    editedAt: null, deletedAt: null, pinnedAt: null, pinnedBy: null,
    systemKind: null, scheduled: false, replyCount: 0, lastReplyAt: null,
    replyParticipantUserIds: [], reactions: [], files: [], unfurls: [],
    ...over,
  };
}

function render(role: MemberRole, row: MessageDTO): string {
  return renderToStaticMarkup(
    <MessageList
      messages={[row]}
      names={{ 'u-me': 'Me', 'u-other': 'Build Bot' }}
      membersById={{
        'u-me': member('u-me', role),
        'u-other': member('u-other', 'member', { isBot: true }),
      }}
      hasMore={false}
      onLoadOlder={() => {}}
      showThreadAffordances
    />,
  );
}

describe('permanent-delete message action', () => {
  it.each(['owner', 'admin'] as const)('shows the permanent action to a workspace %s on a bot message', (role) => {
    const html = render(role, message());
    expect(html).toContain('data-testid="delete-message-m1"');
    expect(html).toContain('title="Permanently delete"');
  });

  it('keeps the action available to an admin on an existing tombstone', () => {
    const html = render('admin', message({ deletedAt: '2026-08-27T00:01:00.000Z', body: '' }));
    expect(html).toContain('data-testid="delete-message-m1"');
  });

  it('hides another author’s delete action from a regular member', () => {
    expect(render('member', message())).not.toContain('data-testid="delete-message-m1"');
  });

  it('keeps a regular author on the ordinary soft-delete action', () => {
    const html = render('member', message({ userId: 'u-me' }));
    expect(html).toContain('data-testid="delete-message-m1"');
    expect(html).toContain('title="Delete"');
    expect(html).not.toContain('title="Permanently delete"');
  });

  it('never renders a delete action for a system courtesy line', () => {
    expect(render('owner', message({ systemKind: 'member_joined' }))).not.toContain('data-testid="delete-message-m1"');
  });
});
