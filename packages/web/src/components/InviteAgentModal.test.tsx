import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The modal reads the signed-in user (for the sponsor email hint) and the live
// pairing requests (to auto-close). Stub both so it renders standalone.
vi.mock('../state', () => ({ useAuth: () => ({ user: { email: 'sponsor@example.com' } }) }));
vi.mock('../hooks', () => ({ useAgentRequests: () => ({ data: [] }) }));

import { InviteAgentModal } from './InviteAgentModal';

describe('InviteAgentModal', () => {
  it('shows the npx command and the sponsor email', () => {
    const html = renderToStaticMarkup(<InviteAgentModal onClose={() => {}} />);
    expect(html).toContain('Invite your Agent');
    expect(html).toContain('npx flow-agent-bridge');
    expect(html).toContain('sponsor@example.com');
    // The pairing-prompt preview is present so sponsors know what to look for.
    expect(html).toContain('asking to join as your agent');
  });
});
