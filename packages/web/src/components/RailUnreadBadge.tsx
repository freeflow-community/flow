/**
 * Unread-count badge on a workspace rail icon (#345).
 *
 * Sits on the icon's top-right corner with a ring in the rail's own background
 * colour, so it reads cleanly whatever the icon underneath is — a photo avatar
 * or a coloured initial. A circle for one digit, widening to a pill for two or
 * three characters; nothing at all at zero, because "0 unread" is not news.
 */
export const UNREAD_CAP = 99;

/** The badge text, or null when there is nothing to show. */
export function unreadLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(Math.floor(count));
}

export function RailUnreadBadge({
  count,
  ringColor,
  testId,
}: {
  count: number;
  /** The rail background, drawn as the ring that separates badge from icon. */
  ringColor: string;
  testId: string;
}) {
  const label = unreadLabel(count);
  if (label === null) return null;
  return (
    <span
      data-testid={testId}
      aria-label={`${count} unread`}
      // pointer-events-none: the badge overlaps the button's corner, and a
      // click there means "open this workspace", not "miss the button".
      className="pointer-events-none absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-unread px-1 text-[10px] font-bold leading-none text-white tabular-nums"
      style={{ boxShadow: `0 0 0 2.5px ${ringColor}` }}
    >
      {label}
    </span>
  );
}
