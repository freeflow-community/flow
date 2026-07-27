// Message attachments as an agent sees them: a one-line note listing the file
// ids on a message, and a safe local filename for the downloaded bytes.
//
// Both the bridge (first-turn history) and the MCP server (read_messages,
// search_history) render the note, so an agent asked about "the video Scott
// posted" can spot the attachment and pull it with the `download_file` tool.
import type { FileDTO } from '@flow/shared';

/** ` [attachments: <id> "clip.mp4" (video/mp4, 1234 bytes); …]` — the ids are
 * what `download_file` takes. Empty string when the message has none, so it
 * appends cleanly to any message line. */
export function formatAttachments(files: FileDTO[] | undefined): string {
  if (!files?.length) return '';
  const parts = files.map((f) => `${f.id} "${f.name}" (${f.mimeType}, ${f.sizeBytes} bytes)`);
  return ` [attachments: ${parts.join('; ')}]`;
}

/** Local filename for a downloaded attachment: the id keeps copies distinct,
 * the (sanitized, tail-trimmed) original name keeps the extension so the
 * runtime's Read renders images natively. */
export function attachmentFilename(fileId: string, name: string | undefined): string {
  const safe = (name ?? '').replace(/[^\w.\-]+/g, '_').slice(-80);
  return `${fileId}-${/[a-z0-9]/i.test(safe) ? safe : 'file'}`;
}
