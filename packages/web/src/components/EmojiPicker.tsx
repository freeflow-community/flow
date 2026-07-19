import { useEffect, useRef, useState } from 'react';
import { EMOJI_SHORTCODES, QUICK_REACTIONS } from '@flow/shared';

/** Custom emoji grid + search (operator ruling: web gets the custom picker). */
export default function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

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
  const results = q
    ? [...new Set(
        Object.entries(EMOJI_SHORTCODES)
          .filter(([code]) => code.includes(q))
          .sort(([a], [b]) => (a.length - b.length) || a.localeCompare(b))
          .map(([, emoji]) => emoji),
      )]
    : QUICK_REACTIONS.concat(
        [...new Set(Object.values(EMOJI_SHORTCODES))].filter((e) => !QUICK_REACTIONS.includes(e)),
      );

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
      <div className="mc-scroll grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
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
        {results.length === 0 && <p className="col-span-8 py-4 text-center text-sm text-faint">No matches</p>}
      </div>
    </div>
  );
}
