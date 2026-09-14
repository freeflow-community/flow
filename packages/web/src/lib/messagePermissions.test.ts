import { describe, expect, it } from 'vitest';
import type { MessageDTO } from '@flow/shared';
import { messageDeleteConfirmation, messageDeleteMode } from './messagePermissions';

const message = (
  userId: string,
  deletedAt: string | null = null,
  systemKind: MessageDTO['systemKind'] = null,
) => ({
  userId,
  deletedAt,
  systemKind,
});

describe('messageDeleteMode', () => {
  it('keeps an ordinary author on the soft-delete path', () => {
    expect(messageDeleteMode(message('me'), 'me', 'member')).toBe('soft');
  });

  it('does not let an ordinary member delete another author or a tombstone', () => {
    expect(messageDeleteMode(message('other'), 'me', 'member')).toBeNull();
    expect(messageDeleteMode(message('me', '2026-08-25T00:00:00Z'), 'me', 'member')).toBeNull();
  });

  it.each(['owner', 'admin'] as const)('%s permanently deletes any user message or tombstone', (role) => {
    expect(messageDeleteMode(message('other'), 'me', role)).toBe('permanent');
    expect(messageDeleteMode(message('other', '2026-08-25T00:00:00Z'), 'me', role)).toBe('permanent');
  });

  it('never offers deletion for system courtesy lines', () => {
    expect(messageDeleteMode(message('other', null, 'member_joined'), 'me', 'owner')).toBeNull();
  });
});

describe('messageDeleteConfirmation', () => {
  it('explains that a member soft delete leaves a notice', () => {
    expect(messageDeleteConfirmation('soft', null, 0)).toEqual({
      title: 'Delete message?',
      body: "The message will be replaced by a deletion notice. This can't be undone.",
      confirmLabel: 'Delete',
    });
  });

  it('warns that permanently deleting a root also removes every reply', () => {
    expect(messageDeleteConfirmation('permanent', null, 7).body).toBe(
      "This will permanently delete the message and all 7 replies. This can't be undone.",
    );
  });

  it('uses singular copy for a root with one reply', () => {
    expect(messageDeleteConfirmation('permanent', null, 1).body).toBe(
      "This will permanently delete the message and all 1 reply. This can't be undone.",
    );
  });

  it('uses the single-message warning for a reply', () => {
    expect(messageDeleteConfirmation('permanent', 'root-1', 0)).toEqual({
      title: 'Permanently delete message?',
      body: "This message will disappear for everyone. This can't be undone.",
      confirmLabel: 'Permanently delete',
    });
  });
});
