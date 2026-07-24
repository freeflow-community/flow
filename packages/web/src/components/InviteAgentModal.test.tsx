import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The modal mints a one-time invite code via useCreateAgentInvite. Stub the hook
// so it renders standalone with a ready code (effects don't run under
// renderToStaticMarkup, so we hand it the resolved data directly).
const code = 'flow-K7P2-9QMR';
vi.mock('../hooks', () => ({
  useCreateAgentInvite: () => ({
    data: { code, command: `npx flow-agent-bridge ${code}`, expiresAt: '' },
    isPending: false,
    isError: false,
    mutate: () => {},
  }),
}));

import { InviteAgentModal } from './InviteAgentModal';

describe('InviteAgentModal', () => {
  it('shows the npx command with the generated invite code', () => {
    const html = renderToStaticMarkup(<InviteAgentModal workspaceId="ws-1" onClose={() => {}} />);
    expect(html).toContain('Invite your Agent');
    expect(html).toContain(`npx flow-agent-bridge ${code}`);
    expect(html).toContain('one-time invite code');
    // The old device-code approval preview is gone.
    expect(html).not.toContain('asking to join as your agent');
  });
});
