import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FileDTO } from '@flow/shared';
import type { FileImageSource } from './FileImage';

vi.mock('../state', () => ({
  useAuth: () => ({ user: { id: 'u1' }, token: 't' }),
  useSelection: () => ({
    workspaceId: 'w1', channelId: 'c1', threadRootId: null,
    editingMessageId: null, openThread: () => {}, setEditingMessage: () => {},
  }),
}));
vi.mock('../hooks', () => ({
  useSendMessage: () => ({ mutate: () => {} }),
  useTogglePin: () => ({ mutate: () => {} }),
  useToggleReaction: () => ({ mutate: () => {} }),
  useWorkspaceEmojiMap: () => ({}),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined, setQueryData: () => {}, removeQueries: () => {}, invalidateQueries: () => Promise.resolve(),
  }),
}));

const { AttachmentImagePreview, attachmentPreviewStyle } = await import('./MessageList');

const file: FileDTO = {
  id: 'f1', workspaceId: 'w1', userId: 'u1', name: 'photo.png', mimeType: 'image/png',
  sizeBytes: 1234, width: 1200, height: 900, hasThumb: true, createdAt: '2026-09-02T00:00:00.000Z',
};

function source(status: FileImageSource['status'], src: string | null = null): FileImageSource {
  return { src, status, onLoad: vi.fn(), onError: vi.fn(), retry: vi.fn() };
}

function render(image: FileImageSource): string {
  return renderToStaticMarkup(
    <AttachmentImagePreview file={file} image={image} onOpen={() => {}} onDownload={async () => {}} />,
  );
}

describe('mobile image attachment states', () => {
  it('gives the loading state definite, viewport-capped geometry', () => {
    const html = render(source('loading'));
    expect(html).toContain('data-testid="file-image-frame-photo.png"');
    expect(html).toContain('width:512px');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('min-height:96px');
    expect(html).toContain('aspect-ratio:1200 / 900');
    expect(html).toContain('Loading preview…');
    expect(html).not.toContain('w-fit');
  });

  it('shows retry and download actions instead of a permanent blank placeholder', () => {
    const html = render(source('failed'));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Preview unavailable');
    expect(html).toContain('data-testid="file-retry-photo.png"');
    expect(html).toContain('data-testid="file-error-download-photo.png"');
  });

  it('renders the decoded image as the lightbox affordance', () => {
    const html = render(source('loaded', 'https://objects.example/photo.webp'));
    expect(html).toContain('data-testid="file-photo.png"');
    expect(html).toContain('src="https://objects.example/photo.webp"');
    expect(html).not.toContain('Loading preview…');
  });

  it('preserves tall-image proportions within the height cap', () => {
    expect(attachmentPreviewStyle({ width: 600, height: 1200 })).toMatchObject({
      width: 240,
      maxWidth: '100%',
      minHeight: 96,
      aspectRatio: '600 / 1200',
    });
  });

  it('uses a visible fallback frame when image dimensions are unavailable', () => {
    expect(attachmentPreviewStyle({ width: null, height: null })).toMatchObject({
      width: 320,
      minHeight: 96,
      aspectRatio: '320 / 240',
    });
  });
});
