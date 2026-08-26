import { describe, expect, it } from 'vitest';
import { kindLabel } from './ActivityView';

// Activity rows name the channel they came from (#267) — without it, rows from
// several busy channels are indistinguishable until you click one.
describe('kindLabel', () => {
  it('names the channel on a thread reply', () => {
    expect(kindLabel(2, 'CypressBot', null, 'bugs')).toBe('CypressBot replied in a thread in #bugs');
  });

  it('names the channel on a post, a mention and a reaction', () => {
    expect(kindLabel(3, 'Scott', null, 'bugs')).toBe('Scott posted in #bugs');
    expect(kindLabel(0, 'Scott', null, 'bugs')).toBe('Scott mentioned you in #bugs');
    expect(kindLabel(4, 'Scott', '🎉', 'bugs')).toBe('Scott reacted 🎉 to your message in #bugs');
  });

  it('leaves DM rows alone — they already say where they came from', () => {
    expect(kindLabel(1, 'Scott', null, null)).toBe('Scott sent you a direct message');
  });

  it('omits the suffix when the channel is unknown', () => {
    // A row from a channel that isn't in this workspace's list (or a DM channel,
    // which has no name) must still render — just without the "in #…".
    expect(kindLabel(2, 'Scott', null, null)).toBe('Scott replied in a thread');
  });

  it('keeps the missing-emoji spacing fix', () => {
    expect(kindLabel(4, 'Scott', null, 'bugs')).toBe('Scott reacted to your message in #bugs');
  });
});
