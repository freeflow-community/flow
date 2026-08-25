import { describe, expect, it } from 'vitest';
import { mayDeleteMessage } from '../src/services/messages.js';

describe('message deletion authorization', () => {
  it('lets an author use the existing soft and permanent paths', () => {
    expect(mayDeleteMessage('author', 'author', 'member', false, false)).toBe(true);
    expect(mayDeleteMessage('author', 'author', 'member', true, false)).toBe(true);
  });

  it.each(['owner', 'admin'] as const)('%s can permanently delete another author', (role) => {
    expect(mayDeleteMessage('moderator', 'author', role, true, false)).toBe(true);
  });

  it('does not turn moderation into a soft delete or grant it to members', () => {
    expect(mayDeleteMessage('admin', 'author', 'admin', false, false)).toBe(false);
    expect(mayDeleteMessage('member', 'author', 'member', true, false)).toBe(false);
  });

  it('keeps system courtesy lines outside the delete action', () => {
    expect(mayDeleteMessage('owner', 'author', 'owner', true, true)).toBe(false);
  });
});
