import { describe, expect, it } from 'vitest';
import type { MessageDTO } from '@flow/shared';
import { messageDeleteMode } from './messagePermissions';

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
