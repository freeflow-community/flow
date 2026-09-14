// delete_artifact (#393). The interesting part is not the DELETE — it is what
// happens around it: the server treats deleting a nonexistent artifact as a
// success, so without the lookup the tool would cheerfully confirm removing
// something that was never there.
import { describe, expect, it } from 'vitest';
import type { ArtifactDTO } from '@flow/shared';
import { FlowApiError } from '../src/api.js';
import { deleteArtifactTool } from '../src/mcp-server.js';

const WS = 'ws-1';

function artifact(over: Partial<ArtifactDTO> = {}): ArtifactDTO {
  return {
    id: 'art-1',
    workspaceId: WS,
    channelId: 'chan-1',
    kind: 'file',
    fileId: 'file-1',
    url: null,
    name: 'coverage.csv',
    ownsFile: true,
    isApp: false,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    file: null,
    ...over,
  };
}

/** A stub FlowApi that records the deletes it was asked for. */
function api(artifacts: ArtifactDTO[], onDelete?: (id: string) => Promise<void>) {
  const deleted: string[] = [];
  return {
    deleted,
    listArtifacts: async () => artifacts,
    deleteArtifact: async (id: string) => {
      deleted.push(id);
      if (onDelete) await onDelete(id);
    },
  };
}

describe('deleteArtifactTool', () => {
  it('deletes a visible artifact and names it in the confirmation', async () => {
    const a = api([artifact()]);
    const res = await deleteArtifactTool(a, WS, 'art-1');
    expect(res.isError).toBe(false);
    expect(res.text).toContain('file artifact "coverage.csv" (id art-1) deleted');
    expect(a.deleted).toEqual(['art-1']);
  });

  it('labels an app artifact as an app', async () => {
    const a = api([artifact({ kind: 'link', fileId: null, url: 'https://x.test', isApp: true, name: 'Dashboard' })]);
    const res = await deleteArtifactTool(a, WS, 'art-1');
    expect(res.isError).toBe(false);
    expect(res.text).toContain('app artifact "Dashboard"');
  });

  it('reports an unknown or already-deleted id instead of a false success', async () => {
    const a = api([artifact()]);
    const res = await deleteArtifactTool(a, WS, 'art-gone');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('no artifact art-gone');
    expect(res.text).toContain('list_artifacts');
    expect(a.deleted).toEqual([]); // never reached the server
  });

  it('rejects a missing artifactId', async () => {
    const res = await deleteArtifactTool(api([]), WS, '');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('needs an artifactId');
  });

  it('explains a permission failure in words', async () => {
    const a = api([artifact()], async () => {
      throw new FlowApiError(403, 'forbidden', 'forbidden');
    });
    const res = await deleteArtifactTool(a, WS, 'art-1');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('not a member of its channel');
  });

  it('explains an unreachable server instead of throwing', async () => {
    const a = {
      listArtifacts: async () => {
        throw new Error('fetch failed');
      },
      deleteArtifact: async () => {},
    };
    const res = await deleteArtifactTool(a, WS, 'art-1');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('could not reach the Flow server');
  });
});
