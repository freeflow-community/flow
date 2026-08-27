import type { MemberRole, MessageDTO } from '@flow/shared';

export type MessageDeleteMode = 'soft' | 'permanent';

export interface MessageDeleteConfirmation {
  title: string;
  body: string;
  confirmLabel: string;
}

/** Client-side affordance only; the server repeats every authorization check. */
export function messageDeleteMode(
  message: Pick<MessageDTO, 'userId' | 'deletedAt' | 'systemKind'>,
  currentUserId: string,
  currentRole: MemberRole | undefined,
): MessageDeleteMode | null {
  if (message.systemKind !== null) return null;
  if (currentRole === 'owner' || currentRole === 'admin') return 'permanent';
  if (message.userId === currentUserId && message.deletedAt === null) return 'soft';
  return null;
}

export function messageDeleteConfirmation(
  mode: MessageDeleteMode,
  threadRootId: string | null,
  replyCount: number,
): MessageDeleteConfirmation {
  if (mode === 'soft') {
    return {
      title: 'Delete message?',
      body: "The message will be replaced by a deletion notice. This can't be undone.",
      confirmLabel: 'Delete',
    };
  }
  return {
    title: 'Permanently delete message?',
    body: threadRootId === null && replyCount > 0
      ? `This will permanently delete the message and all ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}. This can't be undone.`
      : "This message will disappear for everyone. This can't be undone.",
    confirmLabel: 'Permanently delete',
  };
}
