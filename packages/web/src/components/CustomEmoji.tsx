// Custom emoji (#175) rendering. A reaction is just a string, so anywhere one
// is shown it may be either a unicode emoji or a workspace `:shortcode:`.
import { useEffect, useState } from 'react';
import type { WorkspaceEmojiDTO } from '@flow/shared';
import { blobUrl } from '../lib/api';

/** The image for one custom emoji. Bytes come from the ordinary authenticated
 * file endpoint via blobUrl(), which caches per path — so an emoji used on
 * fifty messages is fetched once. */
export function CustomEmojiImage({
  emoji,
  size = 18,
  className = '',
}: {
  emoji: WorkspaceEmojiDTO;
  size?: number;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${emoji.fileId}`)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [emoji.fileId]);

  // Reserve the box before the bytes land so reaction pills don't reflow.
  if (!url) return <span style={{ width: size, height: size }} className="inline-block align-[-3px]" />;
  return (
    <img
      src={url}
      alt={emoji.emoji}
      title={emoji.emoji}
      data-testid={`custom-emoji-${emoji.shortcode}`}
      width={size}
      height={size}
      className={`inline-block object-contain align-[-3px] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * One reaction/picker glyph: the custom image when the string resolves,
 * otherwise the string itself. The fallback is load-bearing — a shortcode whose
 * emoji was deleted (or which this client hasn't fetched yet) renders as plain
 * `:shortcode:` rather than vanishing, so the reaction still reads as something
 * a person chose.
 */
export function EmojiGlyph({
  emoji,
  customEmoji,
  size = 18,
}: {
  emoji: string;
  customEmoji: Record<string, WorkspaceEmojiDTO>;
  size?: number;
}) {
  const custom = customEmoji[emoji];
  if (custom) return <CustomEmojiImage emoji={custom} size={size} />;
  return <>{emoji}</>;
}
