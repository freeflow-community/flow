// The sound a Huddle makes when it actually connects (#509) — audible
// confirmation to go with the visual one, for the very common case of a call
// you started and then looked away from.
//
// Synthesised rather than shipped as an asset, the same call
// apps/macos/.../Support/Ringtone.swift already makes for the incoming ring:
// two hundred milliseconds of sine with a soft decay needs no file, no bundler
// rule and no licence to reason about. Provenance is this function.

/** Two notes a fifth apart, the second overlapping the first's tail. */
const NOTES: { hz: number; at: number }[] = [
  { hz: 660, at: 0 },
  { hz: 990, at: 0.09 },
];
const DURATION = 0.22;
/** Deliberately quiet: this lands in the middle of a call you are listening to. */
const PEAK = 0.09;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Play the connect chime once. Best-effort by design: a browser that blocks
 * audio, or has no Web Audio at all, must not take the call down with it — the
 * chime is confirmation of something the UI already says.
 *
 * It rides the page's ordinary output, which during a huddle is the same
 * device LiveKit's audio elements play through.
 */
export function playConnectChime(): void {
  try {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    const ctx = new Ctor();
    // Autoplay policy: inside a call the page has long since been interacted
    // with, but resume() is free insurance and returns a promise we ignore.
    void ctx.resume?.();
    const start = ctx.currentTime + 0.01;
    for (const note of NOTES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.hz;
      const from = start + note.at;
      // A ramped attack and an exponential decay — gating a sine on and off
      // squarely is a click, which reads as a glitch rather than a chime.
      gain.gain.setValueAtTime(0.0001, from);
      gain.gain.exponentialRampToValueAtTime(PEAK, from + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, from + DURATION);
      osc.connect(gain).connect(ctx.destination);
      osc.start(from);
      osc.stop(from + DURATION + 0.02);
    }
    // Let the tail finish, then hand the hardware back.
    window.setTimeout(() => void ctx.close?.(), 1000);
  } catch {
    /* no audio here; the badge is still the answer */
  }
}
