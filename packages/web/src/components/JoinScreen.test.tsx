import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { UserDTO, WorkspaceDTO } from '@flow/shared';

// The confirm card asks the workspace list whether this user is already a
// member. Stub it so each case renders standalone (effects don't run under
// renderToStaticMarkup, so a real query would sit pending forever).
const memberOf: WorkspaceDTO[] = [];
vi.mock('../hooks', () => ({
  useWorkspaces: () => ({ data: memberOf }),
}));

import { JoinConfirm } from './JoinScreen';

const preview = { workspaceId: 'ws-1', slug: 'flow-home', name: 'Flow Home Team' };
const user = { id: 'u-1', email: 'me@example.com', displayName: 'Me' } as UserDTO;

function render(workspaces: WorkspaceDTO[]) {
  memberOf.length = 0;
  memberOf.push(...workspaces);
  const qc = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <JoinConfirm
        token="wUKq5mdZAFkhUBvIWsdC7A"
        preview={preview}
        user={user}
        onJoined={() => {}}
        onDismiss={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('JoinConfirm', () => {
  it('names the workspace and offers to join it', () => {
    const html = render([]);
    expect(html).toContain('Flow Home Team');
    expect(html).toContain('You’ve been invited to join');
    expect(html).toContain('Join workspace');
    // The whole point of the screen: the visitor knows who they're signed in as.
    expect(html).toContain('me@example.com');
  });

  it('offers to open the workspace instead when already a member', () => {
    const html = render([{ id: 'ws-1', name: 'Flow Home Team' } as WorkspaceDTO]);
    expect(html).toContain('You’re already a member of');
    expect(html).toContain('Open Flow Home Team');
    expect(html).not.toContain('Join workspace');
  });
});
