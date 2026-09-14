import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Hover dwell before the bubble appears (#392) — the platform-ish 500ms, so
 * sweeping the pointer down the sidebar never flashes a trail of tooltips. */
export const TOOLTIP_DELAY_MS = 500;
/** Long topics wrap rather than truncate; this is the wrap width. */
export const TOOLTIP_MAX_WIDTH = 300;
/** Breathing room between the bubble and its anchor / the viewport edge. */
const GAP = 8;
/** Widest anchor, as a fraction of the viewport, that still gets a bubble
 * beside it rather than below. A sidebar row clears this easily; a full-width
 * header line does not. */
const SIDE_PLACEMENT_MAX_ANCHOR = 0.4;

/**
 * The text a tooltip should show, or null for "no tooltip at all" (#392). A
 * channel with no topic — and one whose topic is blank, which the server also
 * stores as null but an older row may not — gets no bubble, not an empty one.
 */
export function tooltipText(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  return text.length > 0 ? text : null;
}

export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * Where the bubble goes: adjacent to the anchor, never on top of it. To the
 * right by default (the sidebar's rows are on the left), flipping left when
 * that would run off screen, and dropping *below* the anchor when neither side
 * fits. That last case is not a rare edge: the channel header's topic line
 * spans the whole header, so a side placement would fling the bubble to the far
 * edge of the window, nowhere near the text it explains. Pure, so the placement
 * rules are testable without a browser.
 */
export function tooltipPosition(
  anchor: Box,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(GAP, Math.min(v, max - GAP));
  // Beside only reads as "attached to this" for something small — a sidebar
  // row. A full-width line has no meaningful side, so putting the bubble level
  // with it flings it to the far edge of the window, which is what the header's
  // topic line did before this check existed.
  const narrow = anchor.right - anchor.left <= viewport.width * SIDE_PLACEMENT_MAX_ANCHOR;
  let left: number;
  let top: number;
  if (narrow && anchor.right + GAP + bubble.width + GAP <= viewport.width) {
    left = anchor.right + GAP;
    top = anchor.top;
  } else if (narrow && anchor.left - GAP - bubble.width >= GAP) {
    left = anchor.left - GAP - bubble.width;
    top = anchor.top;
  } else {
    // Under the anchor, aligned to its left edge — the ordinary tooltip shape
    // for something as wide as its container.
    left = clamp(anchor.left, viewport.width - bubble.width);
    top = anchor.bottom + GAP;
  }
  if (top + bubble.height + GAP > viewport.height) {
    top = clamp(viewport.height - GAP - bubble.height, viewport.height - bubble.height);
  }
  return { left: clamp(left, viewport.width - bubble.width), top };
}

/** What `useHoverTooltip` hands back: spread `anchorProps` onto the element the
 * pointer should hover, and render `tooltip` as a sibling. */
export interface HoverTooltipHandle {
  anchorProps: {
    ref: (el: HTMLElement | null) => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onMouseDown?: () => void;
  };
  tooltip: React.ReactNode;
}

/**
 * A plain-text hover tooltip (#392), as a hook so the hover target can be an
 * element the caller already renders — the sidebar's whole channel row, not
 * just the few dozen pixels its name happens to occupy. Anchoring to the label
 * span alone means a pointer resting anywhere else on the row shows nothing,
 * which is not what "hover the channel" means to anyone using it.
 *
 * Mouse events only: `pointerenter` also fires for touch, and a phone has no
 * hover to speak of. The bubble is portalled to the body so the sidebar's
 * scroll container can't clip it.
 *
 * With no text there are no handlers at all — the caller's element is left
 * exactly as it was, which is what makes "no topic, no tooltip" structural
 * rather than a runtime check that could render an empty bubble.
 */
export function useHoverTooltip(text: string | null | undefined, testId?: string): HoverTooltipHandle {
  const label = tooltipText(text);
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const setAnchor = useCallback((el: HTMLElement | null) => {
    anchorRef.current = el;
  }, []);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
    setPos(null);
  }, []);

  const openSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
  }, []);

  // A topic cleared while its bubble is up would otherwise leave the old text
  // on screen until the pointer moved.
  useEffect(() => {
    if (!label) close();
  }, [label, close]);

  // Measure once the bubble is in the DOM — its height depends on how the
  // topic wrapped, which nothing can know before laying it out.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !bubbleRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const b = bubbleRef.current.getBoundingClientRect();
    setPos(
      tooltipPosition(a, { width: b.width, height: b.height }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [open, label]);

  // A tooltip anchored to a row that scrolls away would hang in mid-air.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!label) return { anchorProps: { ref: setAnchor }, tooltip: null };

  return {
    anchorProps: {
      ref: setAnchor,
      onMouseEnter: openSoon,
      onMouseLeave: close,
      // Clicking the row selects the channel; the bubble has done its job.
      onMouseDown: close,
    },
    tooltip: open
      ? createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            data-testid={testId}
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              maxWidth: TOOLTIP_MAX_WIDTH,
              // Hidden for the one frame between mount and measurement, so the
              // bubble never flashes in the top-left corner.
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="pointer-events-none fixed z-50 whitespace-pre-wrap break-words rounded-lg bg-ink px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
          >
            {label}
          </div>,
          document.body,
        )
      : null,
  };
}

/**
 * The hook wrapped in a span, for callers whose hover target is exactly the
 * text — the channel header's topic line. `className` is always applied, topic
 * or not, so the element it replaces keeps its layout either way.
 */
export function HoverTooltip({
  text,
  className,
  testId,
  children,
}: {
  text: string | null | undefined;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const { anchorProps, tooltip } = useHoverTooltip(text, testId);
  return (
    <>
      <span {...anchorProps} className={className}>
        {children}
      </span>
      {tooltip}
    </>
  );
}
