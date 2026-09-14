import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InviteResultDTO } from '@flow/shared';

// The modal is rendered standalone: the join-link section and the
// self-register toggle both reach for the API and the query client, and
// neither is what this file is about.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock('../lib/useBoundApi', () => ({
  useBoundApi: () => ({ api: async () => { throw new Error('not called in this test'); } }),
}));
vi.mock('../hooks', () => ({
  useWorkspaces: () => ({ data: [] }),
  useSelfRegisterDomain: () => null,
  useMembers: () => ({ data: [] }),
  useMemberMap: () => ({}),
  useChannelMembers: () => ({ data: [] }),
}));

import { InviteModal, InviteResultRow, inviteStatusText, parseInviteEmails, retryableInviteEmails } from './modals';

describe('parseInviteEmails (#578)', () => {
  it('keeps a single address exactly as typed', () => {
    expect(parseInviteEmails('a@example.com')).toEqual(['a@example.com']);
  });

  it('splits on commas, semicolons, spaces and newlines', () => {
    expect(parseInviteEmails('a@x.com, b@x.com;c@x.com d@x.com\ne@x.com')).toEqual([
      'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com',
    ]);
  });

  it('drops empty fragments from trailing and doubled separators', () => {
    expect(parseInviteEmails('  a@x.com ,, , b@x.com,  ')).toEqual(['a@x.com', 'b@x.com']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseInviteEmails('Bob@X.com, bob@x.com, carol@x.com')).toEqual(['Bob@X.com', 'carol@x.com']);
  });

  it('passes a malformed address through — the server decides, not the box', () => {
    expect(parseInviteEmails('nope, real@x.com')).toEqual(['nope', 'real@x.com']);
  });

  it('is empty for whitespace only', () => {
    expect(parseInviteEmails('   \n  ')).toEqual([]);
  });
});

describe('invite results (#578)', () => {
  const mixed: InviteResultDTO[] = [
    { email: 'carol@example.test', status: 'sent', inviteUrl: 'flow://invite/aaa' },
    { email: 'dana@example.test', status: 'resent', inviteUrl: 'flow://invite/bbb' },
    { email: 'bob@qa.local', status: 'already_member' },
    { email: 'nope', status: 'invalid_email' },
    { email: 'erin@example.test', status: 'email_failed', inviteUrl: 'flow://invite/ccc' },
  ];

  it('offers only the undelivered addresses back for a retry', () => {
    expect(retryableInviteEmails(mixed)).toEqual(['nope', 'erin@example.test']);
  });

  it('says something different for every status', () => {
    const texts = mixed.map((r) => inviteStatusText(r.status));
    expect(new Set(texts).size).toBe(mixed.length);
  });

  it('shows the fallback link only for the address whose email failed', () => {
    const html = mixed.map((r) => renderToStaticMarkup(<InviteResultRow result={r} />)).join('');
    expect(html).toContain('Invite emailed');
    expect(html).toContain('Already a member');
    expect(html).toContain('Not a valid email address');
    expect(html).toContain('flow://invite/ccc');
    expect(html).not.toContain('flow://invite/aaa');
    expect(html).not.toContain('flow://invite/bbb');
  });
});

describe('InviteModal', () => {
  const html = renderToStaticMarkup(<InviteModal workspaceId="ws-1" onClose={() => {}} />);

  it('invites several people at once and promises an email to each', () => {
    // renderToStaticMarkup escapes the apostrophe.
    expect(html).toContain('Separate addresses with commas. We&#x27;ll email each person an invite link.');
    expect(html).toContain('Send Invites');
  });

  it('no longer pretends only one address fits', () => {
    expect(html).not.toContain('Send Invite<');
    expect(html).toContain('<textarea');
  });
});
