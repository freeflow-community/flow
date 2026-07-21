// File-type detection shared by chat attachments (MessageList) and the
// artifact panel (phase 9). Mime first, extension as fallback.
import type { FileDTO } from '@flow/shared';

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

function ext(file: FileDTO): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function isTextFile(file: FileDTO): boolean {
  if (file.mimeType.startsWith('text/') || TEXT_MIMES.has(file.mimeType)) return true;
  return TEXT_EXTS.has(ext(file));
}

/** Video formats we render inline (ui_nits); anything the browser can't
 * decode falls back to the file chip at runtime via the <video> error event. */
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);
export function isVideoFile(file: FileDTO): boolean {
  if (file.mimeType.startsWith('video/')) return true;
  return VIDEO_EXTS.has(ext(file));
}

export function isImageFile(file: FileDTO): boolean {
  return file.mimeType.startsWith('image/');
}

/** HTML renders in a sandboxed iframe in the artifact panel (phase 9); in
 * chat it still previews as text. */
export function isHtmlFile(file: FileDTO): boolean {
  return file.mimeType === 'text/html' || ext(file) === 'html' || ext(file) === 'htm';
}

/** Sidebar glyph for an artifact row. */
export function fileGlyph(file: FileDTO): string {
  if (isImageFile(file)) return '🖼️';
  if (isVideoFile(file)) return '🎬';
  if (file.mimeType === 'application/pdf') return '📕';
  if (isHtmlFile(file)) return '🌐';
  if (isTextFile(file)) return '📝';
  return '📄';
}
