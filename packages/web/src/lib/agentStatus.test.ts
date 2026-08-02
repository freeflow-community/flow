import { describe, expect, it } from 'vitest';
import { INTERRUPT_EMOJI, THINKING_PREFIX, isThinkingStatus } from './agentStatus';

describe('isThinkingStatus', () => {
  it('recognises the bridge’s live status row, with or without a step', () => {
    expect(isThinkingStatus('🤖 *thinking…* — Bash: pnpm test')).toBe(true);
    expect(isThinkingStatus(THINKING_PREFIX)).toBe(true);
  });

  it('leaves the agent’s actual messages alone', () => {
    expect(isThinkingStatus('🤖 sorry — I hit an error (no output for 120s).')).toBe(false);
    expect(isThinkingStatus('Here is what I found. I was thinking… about it.')).toBe(false);
  });
});

describe('INTERRUPT_EMOJI', () => {
  // The bridge matches on this exact codepoint; a variation selector or a
  // different stop glyph would make the button silently do nothing.
  it('is the bare stop sign the bridge listens for', () => {
    expect(INTERRUPT_EMOJI).toBe('\u{1F6D1}');
  });
});
