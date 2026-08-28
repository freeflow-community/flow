// File-type detection shared by chat attachments (MessageList) and the
// artifact panel (phase 9). Mime first, extension as fallback.
import type { FileDTO } from '@flow/shared';

/** Everything here keys off name + mime, so callers with a lighter row than a
 * full FileDTO (the channel Files panel, #347) can use it too. */
export type FileKindInput = Pick<FileDTO, 'name' | 'mimeType'>;

/** ASCII-ish formats that get an inline monospace preview (phase 6). */
export const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'swift', 'kt',
  'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml',
  'html', 'htm', 'css', 'scss', 'less', 'sql', 'csv', 'tsv', 'env', 'gitignore',
]);
export const TEXT_MIMES = new Set([
  'application/json', 'application/javascript', 'application/xml',
  'application/x-sh', 'application/x-yaml',
]);

function ext(file: FileKindInput): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function isTextFile(file: FileKindInput): boolean {
  if (file.mimeType.startsWith('text/') || TEXT_MIMES.has(file.mimeType)) return true;
  return TEXT_EXTS.has(ext(file));
}

/** Video formats we render inline (ui_nits); anything the browser can't
 * decode falls back to the file chip at runtime via the <video> error event. */
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);
export function isVideoFile(file: FileKindInput): boolean {
  if (file.mimeType.startsWith('video/')) return true;
  return VIDEO_EXTS.has(ext(file));
}

export function isImageFile(file: FileKindInput): boolean {
  return file.mimeType.startsWith('image/');
}

/** HTML renders in a sandboxed iframe in the artifact panel (phase 9); in
 * chat it still previews as text. */
export function isHtmlFile(file: FileKindInput): boolean {
  return file.mimeType === 'text/html' || ext(file) === 'html' || ext(file) === 'htm';
}

/** Sidebar glyph for an artifact row. */
/** Sidebar/tab glyph for an artifact: a puzzle piece for a mini app (#394),
 * otherwise its backing file's kind glyph (or the link glyph for a plain link
 * pin). Mirrored by `Artifact.glyph` in the macOS client. */
export function artifactGlyph(artifact: { isApp: boolean; file: FileDTO | null }): string {
  return artifact.isApp ? '🧩' : fileGlyph(artifact.file);
}

export function fileGlyph(file: FileDTO | null): string {
  if (!file) return '🔗'; // link artifact (no backing file)
  if (isImageFile(file)) return '🖼️';
  if (isVideoFile(file)) return '🎬';
  if (file.mimeType === 'application/pdf') return '📕';
  if (isHtmlFile(file)) return '🌐';
  if (isTextFile(file)) return '📝';
  return '📄';
}
