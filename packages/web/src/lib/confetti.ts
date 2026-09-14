// Confetti for a 🎉 (#514) — when someone celebrates a message, the moment
// should look like a celebration for everyone with the channel open.
//
// Hand-rolled on one shared canvas rather than a particle library: the whole
// effect is a second of falling rectangles, and a dependency for that would
// cost more to keep than to write. The canvas is created on the first burst
// and removed again when the last particle dies, so a quiet workspace carries
// no overlay at all.

/** Reactions that read as a celebration and so earn a burst. */
export const CELEBRATION_EMOJI = ['🎉', '🎊'];

/** Just the shape of a reaction this module cares about. */
export interface ReactionCount {
  emoji: string;
  count: number;
}

/**
 * Celebration counts as this module last saw them, per message. Module-level
 * (like `scrollMemory` in MessageList) so a row that remounts — switching
 * channels and back, a thread opening — doesn't replay bursts for reactions it
 * already showed.
 */
const lastSeen = new Map<string, Map<string, number>>();
/** Bound the memory on a long-lived tab; oldest messages fall out first. */
const SEEN_LIMIT = 2000;

/**
 * Which celebration emoji were just *added* to this message, folding the new
 * counts into memory as it goes.
 *
 * The first sighting of a message never fires: that is channel load, scrollback
 * and every re-render of history, where existing reactions are just state.
 * Only a count that goes up on a message we already rendered is someone
 * celebrating right now — a local click or another user's reaction arriving
 * over the WS both land here the same way. A count that drops (removal) is
 * recorded silently.
 */
export function celebrationsAdded(messageId: string, reactions: ReactionCount[]): string[] {
  const before = lastSeen.get(messageId);
  const now = new Map<string, number>();
  const added: string[] = [];
  for (const r of reactions) {
    if (!CELEBRATION_EMOJI.includes(r.emoji)) continue;
    now.set(r.emoji, r.count);
    if (before && r.count > (before.get(r.emoji) ?? 0)) added.push(r.emoji);
  }
  if (!before && lastSeen.size >= SEEN_LIMIT) {
    const oldest = lastSeen.keys().next();
    if (!oldest.done) lastSeen.delete(oldest.value);
  }
  lastSeen.set(messageId, now);
  return added;
}

/** Forget every message's counts. Tests only. */
export function resetCelebrationMemory(): void {
  lastSeen.clear();
}

/** Nobody who asked the OS to stop moving things gets confetti. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const COLORS: [string, ...string[]] = ['#f94144', '#f3722c', '#f9c74f', '#43aa8b', '#4d908e', '#9d4edd', '#ff70a6'];
/** Particles per burst, and the ceiling across all live bursts — a pile-on
 * spends what is left of the budget and then stops spawning, so twenty rapid
 * reactions cost the same frame as three. */
const BURST_PARTICLES = 26;
const MAX_PARTICLES = 200;
const LIFE_MS = 1000;
/** px/s² — tuned so a particle falls a few dozen pixels over its short life. */
const GRAVITY = 900;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  w: number;
  h: number;
  color: string;
  age: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let frame = 0;
let lastFrameAt = 0;

/** The overlay: viewport-fixed, click-through, above everything, invisible to
 * assistive tech. It never affects layout, so it can live on document.body. */
function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  const el = document.createElement('canvas');
  el.setAttribute('data-testid', 'confetti-canvas');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  const c2d = el.getContext?.('2d') ?? null;
  if (!c2d) return null;
  document.body.appendChild(el);
  canvas = el;
  ctx = c2d;
  return ctx;
}

function teardown(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  particles = [];
  canvas?.remove();
  canvas = null;
  ctx = null;
}

function resize(): void {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function step(now: number): void {
  frame = 0;
  if (!ctx || !canvas) return;
  // Clamp dt so a backgrounded tab doesn't resume with one enormous jump, and
  // never let it go negative — a clock that runs backwards ages particles
  // backwards, and they stop dying.
  const dt = Math.max(0, Math.min(now - lastFrameAt, 50)) / 1000;
  lastFrameAt = now;
  resize();
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const alive: Particle[] = [];
  for (const p of particles) {
    p.age += dt * 1000;
    if (p.age >= LIFE_MS) continue;
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    alive.push(p);
    // Fades over the last third of its life rather than blinking out.
    ctx.globalAlpha = Math.min(1, (LIFE_MS - p.age) / (LIFE_MS * 0.35));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  particles = alive;
  if (particles.length === 0) teardown();
  else frame = requestAnimationFrame(step);
}

/**
 * Throw a short burst of confetti from a point in viewport coordinates.
 * Best-effort and decorative throughout: no canvas, no motion budget, no
 * confetti — the reaction itself is unaffected either way.
 */
export function burstConfetti(x: number, y: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (prefersReducedMotion()) return;
  const c2d = ensureCanvas();
  if (!c2d) return;
  const room = MAX_PARTICLES - particles.length;
  if (room <= 0) return;
  resize();
  for (let i = 0; i < Math.min(BURST_PARTICLES, room); i++) {
    // Up and outward, with enough spread that no two bursts look alike.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 180 + Math.random() * 220;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 12,
      w: 5 + Math.random() * 4,
      h: 8 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0],
      age: 0,
    });
  }
  if (!frame) {
    lastFrameAt = performance.now();
    frame = requestAnimationFrame(step);
  }
}
