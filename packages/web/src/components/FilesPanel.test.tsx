import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChannelFileDTO } from '@flow/shared';
import { FilesList, durationLabel, itemsLabel } from './FilesPanel';

const file = (over: Partial<ChannelFileDTO> = {}): ChannelFileDTO => ({
  id: 'f-1',
  name: 'team-photo.png',
  mimeType: 'image/png',
  sizeBytes: 1_258_291,
  width: 1200,
  height: 800,
  hasThumb: true,
  userId: 'u-scott',
  uploaderName: 'Scott',
  createdAt: '2026-08-24T10:00:00.000Z',
  messageId: 'm-1',
  ...over,
});

const render = (props: Partial<Parameters<typeof FilesList>[0]> = {}) =>
  renderToStaticMarkup(
    <FilesList
      channelName="factory"
      total={2}
      sort="newest"
      onSort={() => {}}
      rows={[file()]}
      loading={false}
      loadingMore={false}
      onOpen={() => {}}
      {...props}
    />,
  );

describe('itemsLabel', () => {
  it('singularizes one item', () => {
    expect(itemsLabel(1)).toBe('1 item');
    expect(itemsLabel(0)).toBe('0 items');
    expect(itemsLabel(42)).toBe('42 items');
  });
});

describe('durationLabel', () => {
  it('renders m:ss', () => {
    expect(durationLabel(42)).toBe('0:42');
    expect(durationLabel(65)).toBe('1:05');
    expect(durationLabel(3600)).toBe('60:00');
  });
});

describe('FilesList render', () => {
  it('heads the panel with the channel and the item count', () => {
    const html = render({ total: 42 });
    expect(html).toContain('Files');
    expect(html).toContain('#factory');
    expect(html).toContain('42 items');
  });

  it('offers exactly the four sort links, with the active one highlighted', () => {
    const html = render({ sort: 'size' });
    for (const s of ['newest', 'oldest', 'name', 'size']) expect(html).toContain(`files-sort-${s}`);
    // no dropdown — plain buttons only
    expect(html).not.toContain('<select');
    // the active link is the one marked current
    const active = html.slice(html.indexOf('files-sort-size'));
    expect(active).toContain('aria-current="true"');
  });

  it('shows name, size, uploader and date plus a download button per row', () => {
    const html = render({ rows: [file({ name: 'Q3-roadmap.pdf', mimeType: 'application/pdf', hasThumb: false })] });
    expect(html).toContain('Q3-roadmap.pdf');
    expect(html).toContain('1.2 MB');
    expect(html).toContain('Scott');
    expect(html).toContain('files-download-Q3-roadmap.pdf');
    // a non-previewable type gets its extension block, not a thumbnail
    expect(html).toContain('pdf');
  });

  it('shows the empty state when nothing has been shared', () => {
    const html = render({ rows: [], total: 0 });
    expect(html).toContain('No files shared yet');
    expect(html).toContain('0 items');
  });

  it('says nothing about emptiness while the first page is in flight', () => {
    const html = render({ rows: [], loading: true });
    expect(html).not.toContain('No files shared yet');
    expect(html).toContain('Loading');
  });

  it('marks a video row with a duration badge placeholder', () => {
    const html = render({ rows: [file({ name: 'demo.mp4', mimeType: 'video/mp4', hasThumb: false })] });
    expect(html).toContain('files-row-demo.mp4');
    expect(html).toContain('▶'); // duration fills in once metadata loads
  });
});
