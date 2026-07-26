import { describe, expect, it } from 'vitest';
import type { FileDTO } from '@flow/shared';
import { attachmentFilename, formatAttachments } from '../src/attachments.js';
import { filenameFromDisposition } from '../src/api.js';

const file = (over: Partial<FileDTO> = {}): FileDTO => ({
  id: 'file-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  name: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 2048,
  width: null,
  height: null,
  hasThumb: false,
  createdAt: '2026-07-24T03:24:53.051Z',
  ...over,
});

describe('formatAttachments', () => {
  it('is empty for a message with no files', () => {
    expect(formatAttachments([])).toBe('');
    expect(formatAttachments(undefined)).toBe('');
  });

  it('names the file id, filename, type and size', () => {
    expect(formatAttachments([file()])).toBe(' [attachments: file-1 "clip.mp4" (video/mp4, 2048 bytes)]');
  });

  it('joins several files into one note', () => {
    const note = formatAttachments([file(), file({ id: 'file-2', name: 'shot.png', mimeType: 'image/png' })]);
    expect(note).toContain('file-1 "clip.mp4"');
    expect(note).toContain('file-2 "shot.png" (image/png, 2048 bytes)');
    expect(note.startsWith(' [attachments: ')).toBe(true);
  });
});

describe('attachmentFilename', () => {
  it('prefixes the id and keeps the extension', () => {
    expect(attachmentFilename('file-1', 'clip.mp4')).toBe('file-1-clip.mp4');
  });

  it('collapses path separators and other unsafe characters', () => {
    expect(attachmentFilename('file-1', '../../etc/passwd')).toBe('file-1-.._.._etc_passwd');
  });

  it('falls back when the name is missing or sanitizes away', () => {
    expect(attachmentFilename('file-1', undefined)).toBe('file-1-file');
    expect(attachmentFilename('file-1', '///')).toBe('file-1-file');
  });

  it('keeps the tail of a very long name (extension survives)', () => {
    const name = `${'a'.repeat(200)}.png`;
    const out = attachmentFilename('file-1', name);
    expect(out.endsWith('.png')).toBe(true);
    expect(out.length).toBe('file-1-'.length + 80);
  });
});

describe('filenameFromDisposition', () => {
  it('decodes the RFC 5987 form the server sends', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''my%20clip.mp4")).toBe('my clip.mp4');
  });

  it('accepts the plain quoted form', () => {
    expect(filenameFromDisposition('attachment; filename="shot.png"')).toBe('shot.png');
  });

  it('returns undefined when absent or nameless', () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition('inline')).toBeUndefined();
  });

  it('keeps the raw value when the escapes are malformed', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBe('%E0%A4%A');
  });
});
