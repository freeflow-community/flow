import { useEffect, useRef, useState } from 'react';
import { EMOJI_SHORTCODES, QUICK_REACTIONS } from '@flow/shared';
import { useWorkspaceEmoji } from '../hooks';
import { CustomEmojiImage } from './CustomEmoji';

/** Custom emoji grid + search (operator ruling: web gets the custom picker). */
export default function EmojiPicker({
  onPick,
  onClose,
  workspaceId,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /**
   * Enables the workspace custom-emoji section (#175). Opt-in, and deliberately
   * *not* passed by the composer: picking there inserts into message text,
   * where a `:shortcode:` would render as literal text rather than an image.
   * Only the reaction picker can honour a custom pick today.
   */
  workspaceId?: string | null;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const custom = useWorkspaceEmoji(workspaceId ?? null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const q = search.trim().toLowerCase();
  // Substring match, prefix hits first (ui_nits; same ranking as emojiMatches).
  const rank = (code: string) => (code.startsWith(q) ? 0 : 1);
  const results = q
    ? [...new Set(
        Object.entries(EMOJI_SHORTCODES)
          .filter(([code]) => code.includes(q))
          .sort(([a], [b]) => (rank(a) - rank(b)) || (a.length - b.length) || a.localeCompare(b))
          .map(([, emoji]) => emoji),
      )]
    : QUICK_REACTIONS.concat(
        [...new Set(Object.values(EMOJI_SHORTCODES))].filter((e) => !QUICK_REACTIONS.includes(e)),
      );

  // Custom emoji match on shortcode only — there is no unicode name to search.
  const customResults = (custom.data ?? [])
    .filter((e) => !q || e.shortcode.includes(q))
    .sort((a, b) => (rank(a.shortcode) - rank(b.shortcode)) || a.shortcode.localeCompare(b.shortcode));

  return (
    <div ref={ref} data-testid="emoji-picker" className="w-72 rounded-lg border border-hairline bg-white p-2 shadow-xl">
      <input
        data-testid="emoji-search"
        className="mb-2 w-full rounded border border-hairline2 px-2 py-1 text-sm"
        placeholder="Search emoji"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="mc-scroll max-h-48 overflow-y-auto">
        {customResults.length > 0 && (
          <>
            <p className="px-1 pb-1 text-[10px] font-semibold text-faint uppercase">Custom</p>
            <div className="mb-2 grid grid-cols-8 gap-0.5">
              {customResults.slice(0, 100).map((e) => (
                <button
                  key={e.id}
                  data-testid={`emoji-${e.emoji}`}
                  title={e.emoji}
                  className="flex items-center justify-center rounded p-1 hover:bg-daypill"
                  onClick={() => onPick(e.emoji)}
                >
                  <CustomEmojiImage emoji={e} size={20} />
                </button>
              ))}
            </div>
          </>
        )}
        {customResults.length > 0 && results.length > 0 && (
          <p className="px-1 pb-1 text-[10px] font-semibold text-faint uppercase">Emoji</p>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {results.slice(0, 200).map((emoji) => (
            <button
              key={emoji}
              data-testid={`emoji-${emoji}`}
              className="rounded p-1 text-xl hover:bg-daypill"
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        {results.length === 0 && customResults.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">No matches</p>
        )}
      </div>
    </div>
  );
}
