import type { MemberRole, MessageDTO } from '@flow/shared';

export type MessageDeleteMode = 'soft' | 'permanent';

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
