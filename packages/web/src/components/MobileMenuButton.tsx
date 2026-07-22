import { useMobileNav } from '../state';

/**
 * Hamburger that opens the nav drawer — mobile only (the rail + sidebar are
 * always visible at `md` and up). Rendered at the left of each pane header so
 * a full-width conversation can always get back to the channel list.
 */
export function MobileMenuButton() {
  const nav = useMobileNav();
  return (
    <button
      data-testid="mobile-menu"
      aria-label="Open channel list"
      className="-ml-1.5 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-ink-soft hover:bg-daypill hover:text-ink md:hidden"
      onClick={nav.openDrawer}
    >
      ☰
    </button>
  );
}
