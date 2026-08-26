import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The dialog reads the workspace name out of the list and calls the API on
// confirm. Both are stubbed: this test is about the copy and the affordances,
// which is the part of leaving a workspace a user has to trust before clicking.
vi.mock('../hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws-1', name: 'Berkeley Zone' }] }),
}));
vi.mock('../state', () => ({
  useSelection: () => ({ selectWorkspace: () => {} }),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../lib/api', () => ({ api: () => Promise.resolve({}), uploadAvatar: () => {}, uploadWorkspaceAvatar: () => {} }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }) }));

import { LeaveWorkspaceModal } from './modals';

describe('LeaveWorkspaceModal', () => {
  const html = renderToStaticMarkup(<LeaveWorkspaceModal workspaceId="ws-1" onClose={() => {}} />);

  it('names the workspace being left', () => {
    expect(html).toContain('Leave Berkeley Zone?');
  });

  it('says what is lost and what survives', () => {
    expect(html).toContain('lose access to all its channels');
    expect(html).toContain('past messages will remain');
  });

  it('offers both a destructive confirm and a way out', () => {
    expect(html).toContain('Leave workspace');
    expect(html).toContain('bg-red-600'); // confirm is styled destructive
    expect(html).toContain('Cancel');
  });
});
