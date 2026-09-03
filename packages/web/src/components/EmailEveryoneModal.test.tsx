// Community email composer (#481): the wording rules the modal owns. The
// rendering and sending halves are network-bound (recipient count, preview
// HTML, the send itself all come from the server), so what is worth pinning
// here is the copy that has to stay right — a "1 person" that reads "1 people"
// in front of the whole community is exactly the kind of thing nobody catches
// until it has already been mailed.
import { describe, expect, it } from 'vitest';
import { peopleLabel, resultToastText } from './EmailEveryoneModal';

describe('peopleLabel', () => {
  it('singularizes one and pluralizes everything else', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(0)).toBe('0 people');
    expect(peopleLabel(42)).toBe('42 people');
  });
});

describe('resultToastText', () => {
  it('stays quiet about failures when there were none', () => {
    expect(resultToastText({ sent: 42, failed: 0 })).toBe('Sent to 42 people');
    expect(resultToastText({ sent: 1, failed: 0 })).toBe('Sent to 1 person');
  });

  it('names the failures when there were any', () => {
    expect(resultToastText({ sent: 41, failed: 1 })).toBe('Sent to 41, failed for 1');
    expect(resultToastText({ sent: 0, failed: 3 })).toBe('Sent to 0, failed for 3');
  });
});
