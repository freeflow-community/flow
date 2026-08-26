import { describe, expect, it } from 'vitest';
import type { WorkspaceMemberDTO } from '@flow/shared';
import { workspaceExit } from './workspaceExit';

// Which way out the workspace menu offers (#340), and specifically the case
// that shipped broken: the roster is undefined until the member fetch lands,
// and treating "not loaded" as "nobody else here" offered Delete on workspaces
// full of people — which the server then refused.
const ME = 'me';
const member = (userId: string, over: Partial<WorkspaceMemberDTO> = {}): WorkspaceMemberDTO =>
  ({ userId, isAgent: false, isBot: false, ...over }) as WorkspaceMemberDTO;

describe('workspaceExit', () => {
  it('lets anyone but the owner just leave', () => {
    expect(workspaceExit('member', [member(ME), member('b')], ME)).toBe('leave');
    expect(workspaceExit('admin', [member(ME), member('b')], ME)).toBe('leave');
  });

  it('makes an owner with company transfer first', () => {
    expect(workspaceExit('owner', [member(ME), member('b')], ME)).toBe('transferFirst');
  });

  it('lets an owner who is alone delete', () => {
    expect(workspaceExit('owner', [member(ME)], ME)).toBe('delete');
  });

  it('does not count agents or bots as company', () => {
    const roster = [member(ME), member('a', { isAgent: true }), member('b', { isBot: true })];
    expect(workspaceExit('owner', roster, ME)).toBe('delete');
  });

  it('does not mistake a roster that has not loaded for being alone', () => {
    expect(workspaceExit('owner', undefined, ME)).toBe('transferFirst');
    expect(workspaceExit('owner', [], ME)).toBe('transferFirst');
  });

  it('does not trust a roster it cannot find itself in', () => {
    // Mid-refetch the rows can belong to another workspace. Not finding
    // ourselves means we don't know who is here — not that we're alone.
    expect(workspaceExit('owner', [member('a'), member('b')], ME)).toBe('transferFirst');
  });

  it('still lets a plain member leave when the roster is unknown', () => {
    // The safe fallback must not take Leave away: it isn't destructive, and
    // the server decides anyway.
    expect(workspaceExit('member', undefined, ME)).toBe('leave');
  });
});
