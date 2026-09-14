import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ArtifactDTO, FileDTO } from '@flow/shared';
import { MarkdownReport } from './ArtifactView';
import { InlineLinkContext, renderBlocks } from '../lib/format';
import { isMarkdownFile } from '../lib/fileKind';
import { shouldOpenArtifact } from '../lib/artifactDelivery';

describe('report rendering and delivery', () => {
  it('renders the requested comparison matrix and headings instead of Markdown source', () => {
    const html = renderToStaticMarkup(<MarkdownReport text={'# Flow vs Slack\n\n| Feature | Flow | Slack |\n| --- | --- | --- |\n| Threads | Yes | Yes |\n\n**Conclusion:** read the report.'} />);
    expect(html).toContain('<h1');
    expect(html).toContain('<table');
    expect(html).toContain('Threads</td>');
    expect(html).toContain('<strong>Conclusion:</strong>');
    expect(html).not.toContain('| --- |');
  });

  it('does not execute raw HTML or unsafe links', () => {
    const html = renderToStaticMarkup(<MarkdownReport text={'<script>alert(1)</script>\n[bad](javascript:alert)'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });

  it('detects old Markdown uploads by extension as well as MIME', () => {
    expect(isMarkdownFile({ name: 'report.MD', mimeType: 'application/octet-stream' } as FileDTO)).toBe(true);
    expect(isMarkdownFile({ name: 'Report', mimeType: 'text/markdown; charset=utf-8' } as FileDTO)).toBe(true);
    expect(isMarkdownFile({ name: 'server.log', mimeType: 'text/plain' } as FileDTO)).toBe(false);
  });

  it('renders durable report links as app buttons, not downloads or link pins', () => {
    const html = renderToStaticMarkup(<InlineLinkContext.Provider value={{ onOpenArtifact: () => {}, onPinLink: () => {} }}>
      {renderBlocks('[Open report](flow-artifact:01900000-0000-7000-a000-000000000001)', {}, undefined)}
    </InlineLinkContext.Provider>);
    expect(html).toContain('data-testid="open-report"');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('inline-link-pin');
  });

  it('opens only for the requester in the originating conversation, regardless of ownership', () => {
    const report = { requesterUserId: 'alice', channelId: 'general', sourceThreadRootId: 'thread', ownsFile: false } as ArtifactDTO;
    expect(shouldOpenArtifact(report, 'alice', 'general', 'thread')).toBe(true);
    expect(shouldOpenArtifact(report, 'bob', 'general', 'thread')).toBe(false);
    expect(shouldOpenArtifact(report, 'alice', 'general', null)).toBe(false);
    expect(shouldOpenArtifact(report, 'alice', 'other', 'thread')).toBe(false);
    expect(shouldOpenArtifact({ ...report, requesterUserId: null, ownsFile: true }, 'alice', 'general', 'thread')).toBe(false);
  });
});
