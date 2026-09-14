// Side-panel keep-alive (issue #513): which artifact frame stays mounted while
// another tab is showing. The decision is the whole of the fix that can be
// checked without a browser — that a link frame survives a tab toggle, that it
// is dropped when the channel changes, and that only one is ever held. The
// no-reload behaviour itself was verified against a running app (see the PR).
import { describe, expect, it } from 'vitest';
import type { ArtifactDTO } from '@flow/shared';
import { nextKeepAlive, type KeepAlive } from './SidePanel';

const artifact = (over: Partial<ArtifactDTO> = {}): ArtifactDTO =>
  ({
    id: 'a-app',
    workspaceId: 'w-1',
    channelId: 'c-1',
    kind: 'link',
    name: 'Task Board',
    url: 'https://board.example.com/',
    isApp: true,
    ...over,
  }) as ArtifactDTO;

const alive: KeepAlive = { channelId: 'c-1', artifactId: 'a-app' };

describe('nextKeepAlive', () => {
  it('holds a link artifact once it is selected', () => {
    expect(nextKeepAlive(null, 'c-1', artifact())).toEqual(alive);
  });

  it('keeps holding it while another tab shows — the point of the fix', () => {
    // Thread / Files tab active: nothing is selected, the frame stays.
    expect(nextKeepAlive(alive, 'c-1', null)).toBe(alive);
  });

  it('returns the previous value by identity so a render-phase update settles', () => {
    expect(nextKeepAlive(alive, 'c-1', artifact())).toBe(alive);
  });

  it('keeps the app frame when a plain file artifact is opened alongside it', () => {
    expect(nextKeepAlive(alive, 'c-1', artifact({ id: 'a-png', kind: 'file' }))).toBe(alive);
  });

  it('holds only the most recent link — one frame, not a pile', () => {
    expect(nextKeepAlive(alive, 'c-1', artifact({ id: 'a-other' }))).toEqual({
      channelId: 'c-1',
      artifactId: 'a-other',
    });
  });

  it('drops the frame when the channel changes', () => {
    expect(nextKeepAlive(alive, 'c-2', null)).toBeNull();
  });

  it('drops the frame when there is no channel at all', () => {
    expect(nextKeepAlive(alive, null, null)).toBeNull();
  });

  it('does not start holding a file artifact — a blob viewer is cheap to rebuild', () => {
    expect(nextKeepAlive(null, 'c-1', artifact({ id: 'a-png', kind: 'file' }))).toBeNull();
  });
});
