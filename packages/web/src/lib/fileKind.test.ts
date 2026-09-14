import { describe, expect, it } from 'vitest';
import type { FileDTO } from '@flow/shared';
import { isMarkdownFile, isTextFile } from './fileKind';

function file(name: string, mimeType: string): FileDTO {
  return {
    id: 'f1',
    workspaceId: 'w1',
    userId: 'u1',
    name,
    mimeType,
    sizeBytes: 10,
    width: null,
    height: null,
    hasThumb: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('isMarkdownFile (#569)', () => {
  it('matches on the markdown mime types', () => {
    expect(isMarkdownFile(file('notes', 'text/markdown'))).toBe(true);
    expect(isMarkdownFile(file('notes', 'text/x-markdown'))).toBe(true);
  });

  it('matches on extension when the upload carried no useful mime', () => {
    // Browsers hand us '' for .md from a file picker, and agents that skip the
    // mime map send application/octet-stream.
    expect(isMarkdownFile(file('README.md', ''))).toBe(true);
    expect(isMarkdownFile(file('README.MD', 'application/octet-stream'))).toBe(true);
    expect(isMarkdownFile(file('notes.markdown', 'text/plain'))).toBe(true);
  });

  it('leaves other text files alone', () => {
    expect(isMarkdownFile(file('main.ts', 'text/plain'))).toBe(false);
    expect(isMarkdownFile(file('notes.txt', 'text/plain'))).toBe(false);
    expect(isMarkdownFile(file('data.json', 'application/json'))).toBe(false);
  });

  it('is a SUBSET of isTextFile — every router must test markdown first', () => {
    // This is the trap the two call sites have a comment about: if the text
    // branch runs first it swallows every markdown file and the viewer never
    // renders. Guard the invariant here so a reorder fails a test, not a demo.
    for (const f of [file('README.md', ''), file('notes', 'text/markdown')]) {
      expect(isMarkdownFile(f)).toBe(true);
      expect(isTextFile(f)).toBe(true);
    }
  });
});
