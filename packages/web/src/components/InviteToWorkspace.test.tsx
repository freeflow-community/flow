import { describe, expect, it } from 'vitest';
import type { UserDTO, WorkspaceDTO } from '@flow/shared';
import { ApiError } from '../lib/api';
import { inviteErrorText } from './modals';

const agent = { id: 'u-agent', displayName: 'Prism', isAgent: true } as UserDTO;
const acme = { id: 'ws-1', name: 'Acme', slug: 'acme' } as WorkspaceDTO;

describe('invite error messages (#358)', () => {
  it('names the member and the workspace for already_member', () => {
    const text = inviteErrorText(new ApiError(409, 'already_member', 'nope'), agent, acme);
    expect(text).toBe('Prism is already in Acme.');
  });

  it('explains a handle collision rather than repeating the code', () => {
    const text = inviteErrorText(new ApiError(409, 'username_taken', 'nope'), agent, acme);
    expect(text).toContain("already uses Prism's handle");
    expect(text).toContain('Acme');
  });

  it('reads a duplicate person-invite as already invited', () => {
    const text = inviteErrorText(new ApiError(409, 'invite_exists', 'nope'), agent, acme);
    expect(text).toBe('Prism has already been invited to Acme.');
  });

  it('falls back to the server message for anything else', () => {
    expect(inviteErrorText(new ApiError(500, 'boom', 'server exploded'), agent, acme)).toBe('server exploded');
  });
});
