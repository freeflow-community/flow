import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HoverTooltip, TOOLTIP_DELAY_MS, TOOLTIP_MAX_WIDTH, tooltipPosition, tooltipText } from './HoverTooltip';

// #392 — the channel topic tooltip. The rule that matters: no topic means no
// tooltip at all, never an empty bubble.
describe('tooltipText', () => {
  it('keeps a real topic', () => {
    expect(tooltipText('Release planning')).toBe('Release planning');
  });

  it('gives nothing for a channel with no topic', () => {
    expect(tooltipText(null)).toBeNull();
    expect(tooltipText(undefined)).toBeNull();
  });

  it('gives nothing for a blank topic', () => {
    // An empty topic clears to null server-side, but a whitespace-only one
    // could still reach a client — it must not open an empty bubble either.
    expect(tooltipText('')).toBeNull();
    expect(tooltipText('   \n ')).toBeNull();
  });

  it('trims, so the bubble is not padded by stray whitespace', () => {
    expect(tooltipText('  standups  ')).toBe('standups');
  });
});

describe('tooltipPosition', () => {
  const viewport = { width: 1200, height: 800 };
  const bubble = { width: 300, height: 60 };
  const anchor = (over: Partial<{ top: number; left: number; right: number; bottom: number }> = {}) => ({
    top: 100,
    left: 20,
    right: 200,
    bottom: 120,
    ...over,
  });

  it('sits beside the anchor, never over it', () => {
    const { left, top } = tooltipPosition(anchor(), bubble, viewport);
    expect(left).toBeGreaterThan(anchor().right);
    expect(top).toBe(anchor().top);
  });

  it('flips to the left when the right edge would run off screen', () => {
    const a = anchor({ left: 900, right: 1100 });
    const { left } = tooltipPosition(a, bubble, viewport);
    expect(left + bubble.width).toBeLessThanOrEqual(a.left);
  });

  it('drops below a wide anchor instead of flinging the bubble to a far edge', () => {
    // The channel header's topic line spans the whole header. A side placement
    // technically "fits" to its left — and lands the bubble in the far corner,
    // nowhere near the text it explains. Below is the only sane read.
    const a = anchor({ left: 320, right: 1260, top: 40, bottom: 60 });
    const { left, top } = tooltipPosition(a, bubble, viewport);
    expect(top).toBeGreaterThanOrEqual(a.bottom);
    expect(left).toBeCloseTo(a.left, 0);
  });

  it('stays on screen when the anchor is wider than the viewport', () => {
    const { left } = tooltipPosition(anchor({ left: 40, right: 1150 }), bubble, { width: 400, height: 800 });
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + bubble.width).toBeLessThanOrEqual(400);
  });

  it('lifts a bubble that would hang off the bottom', () => {
    const { top } = tooltipPosition(anchor({ top: 780, bottom: 800 }), bubble, viewport);
    expect(top + bubble.height).toBeLessThanOrEqual(viewport.height);
  });
});

describe('HoverTooltip', () => {
  it('renders a plain span, keeping the caller classes, when there is no topic', () => {
    // The caller's layout classes live on this span — dropping them for a
    // topicless channel would visibly break the row it wraps.
    const html = renderToStaticMarkup(
      <HoverTooltip text={null} className="truncate text-white/82">#random</HoverTooltip>,
    );
    expect(html).toBe('<span class="truncate text-white/82">#random</span>');
    expect(html).not.toContain('role="tooltip"');
  });

  it('renders no bubble until hovered, even with a topic', () => {
    const html = renderToStaticMarkup(
      <HoverTooltip text="Release planning" className="truncate">#releases</HoverTooltip>,
    );
    expect(html).toContain('#releases');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('Release planning');
  });

  it('uses the standard hover delay and wrap width', () => {
    expect(TOOLTIP_DELAY_MS).toBe(500);
    expect(TOOLTIP_MAX_WIDTH).toBe(300);
  });
});
