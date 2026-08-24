import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceDTO } from '@flow/shared';

// The workspace-branding modal (#336) reads the workspace out of the cached
// list, so stub the hook and render it statically for each of the two states
// that matter: no avatar (upload prompt) and one set (replace + remove).
const base: WorkspaceDTO = {
  id: 'ws-1',
  slug: 'acme',
  name: 'Acme',
  createdBy: 'u-1',
  createdAt: '',
  sidebarColor: 'violet',
  avatarUrl: null,
  googleSelfRegisterDomain: null,
};

let workspace: WorkspaceDTO = base;
vi.mock('../hooks', () => ({
  useWorkspaces: () => ({ data: [workspace] }),
  useMembers: () => ({ data: [] }),
  useMemberMap: () => ({}),
  useChannelMembers: () => ({ data: [] }),
  useSelfRegisterDomain: () => null,
}));

const { WorkspaceColorModal } = await import('./modals');

function render(ws: WorkspaceDTO): string {
  workspace = ws;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceColorModal workspaceId={ws.id} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('WorkspaceColorModal', () => {
  it('offers an upload and no Remove when the workspace has no avatar', () => {
    const html = render(base);
    expect(html).toContain('Workspace appearance');
    expect(html).toContain('workspace-avatar-input');
    expect(html).toContain('Upload image…');
    expect(html).toContain('workspace-avatar-placeholder'); // the initial mark
    expect(html).not.toContain('workspace-avatar-remove');
    expect(html).toContain('color-swatch-violet'); // the color picker is still here
  });

  it('offers Replace and Remove once an avatar is set', () => {
    const html = render({ ...base, avatarUrl: '/v1/avatars/ws-1-123.webp' });
    expect(html).toContain('Replace image…');
    expect(html).toContain('workspace-avatar-remove');
    expect(html).not.toContain('workspace-avatar-placeholder');
  });
});
