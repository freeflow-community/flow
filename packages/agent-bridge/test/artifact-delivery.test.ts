import { describe, expect, it, vi } from 'vitest';
import type { ArtifactDTO, MessageDTO } from '@flow/shared';
import { deliverArtifact, deliveryId, inlineArtifactFile } from '../src/artifact-delivery.js';

const report = { id: '01900000-0000-7000-a000-000000000001', channelId: 'channel', name: 'Sample report' } as ArtifactDTO;

describe('report delivery', () => {
  it('preserves identity across retries and separates different operations', () => {
    expect(deliveryId('source', 'report')).toBe(deliveryId('source', 'report'));
    expect(deliveryId('source', 'report')).not.toBe(deliveryId('other-source', 'report'));
    expect(deliveryId('source', 'report')).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  });

  it('defaults inline reports to Markdown and separates the display name from the filename', () => {
    expect(inlineArtifactFile('Sample report')).toEqual({ filename: 'Sample report.md', mime: 'text/markdown' });
    expect(inlineArtifactFile('Report', 'text/html')).toEqual({ filename: 'Report.html', mime: 'text/html' });
    expect(inlineArtifactFile('Report', 'text/markdown', 'comparison.md').filename).toBe('comparison.md');
  });

  it('posts a persistent artifact reference in the source thread with a stable message key', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: 'message' } as MessageDTO);
    const first = await deliverArtifact({ sendMessage }, report, 'thread');
    await deliverArtifact({ sendMessage }, report, 'thread');
    expect(sendMessage.mock.calls[0]).toEqual(sendMessage.mock.calls[1]);
    expect(sendMessage.mock.calls[0]?.slice(0, 4)).toEqual([
      'channel', `[Open report: Sample report](flow-artifact:${report.id})`, 'thread', undefined,
    ]);
    expect(first.structuredContent).toMatchObject({ artifactId: report.id, messageId: 'message', status: 'delivered' });
  });

  it('reports saved-but-undelivered state and recovers without a new artifact', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'message' });
    const failed = await deliverArtifact({ sendMessage }, report);
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ artifactId: report.id, status: 'delivery_failed' });
    const retried = await deliverArtifact({ sendMessage }, report);
    expect(retried.isError).toBe(false);
    expect(sendMessage.mock.calls[0]?.[4]).toBe(sendMessage.mock.calls[1]?.[4]);
  });

  it('keeps brackets and newlines in titles from breaking the report reference', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: 'message' });
    await deliverArtifact({ sendMessage }, { ...report, name: 'Report ]\n[ injected' });
    expect(sendMessage.mock.calls[0]?.[1]).toBe(`[Open report: Report     injected](flow-artifact:${report.id})`);
  });
});
