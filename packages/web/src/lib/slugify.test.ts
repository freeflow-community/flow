import { describe, expect, it } from 'vitest';
import { EMPTY_SLUG_FIELD, slugEdited, slugForName, slugify } from './slugify';

// Every expectation below was produced by *running* the Swift rule from
// WorkspaceSwitcherView.swift / SidebarDrawer.swift over the same input, not
// by reading it. If one of these ever fails, the three clients have drifted
// and the question is which copy moved.
describe('slugify', () => {
  it('lowercases and dashes the issue-256 example', () => {
    expect(slugify('Testing')).toBe('testing');
  });

  it('turns each non-alphanumeric run into a single dash', () => {
    expect(slugify('Acme Inc')).toBe('acme-inc');
    expect(slugify('multiple   spaces')).toBe('multiple-spaces');
    expect(slugify('a_b.c/d')).toBe('a-b-c-d');
    expect(slugify('Flow 2.0')).toBe('flow-2-0');
    expect(slugify('My--Workspace')).toBe('my-workspace');
    expect(slugify("Flow’s Team")).toBe('flow-s-team');
    expect(slugify('tab\there')).toBe('tab-here');
  });

  it('trims leading and trailing dashes, including the ones it just made', () => {
    expect(slugify('  Leading and trailing  ')).toBe('leading-and-trailing');
    expect(slugify('-leading-dash-')).toBe('leading-dash');
  });

  it('yields empty for a name with nothing alphanumeric in it', () => {
    // The form keeps Create disabled on an empty slug, so these are refused
    // rather than sent — same as macOS and iOS.
    expect(slugify('')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify('---')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('keeps letters and numbers from any script, as Swift isLetter/isNumber does', () => {
    expect(slugify('Ünïcödé Wörks')).toBe('ünïcödé-wörks');
    expect(slugify('Москва')).toBe('москва');
    expect(slugify('東京 Tokyo')).toBe('東京-tokyo');
    expect(slugify('Straße')).toBe('straße');
    expect(slugify('١٢٣ nums')).toBe('١٢٣-nums');
    expect(slugify('ＡＢＣ')).toBe('ａｂｃ');
    expect(slugify('½ half')).toBe('½-half'); // isNumber covers No, not just digits
  });

  it('keeps a combining mark attached to its base letter', () => {
    // The reason this iterates graphemes rather than code points: macOS hands
    // out decomposed text, and a naive port turns NFD "Café" into "cafe".
    expect(slugify('Caf\u00e9')).toBe('caf\u00e9'); // NFC: e-acute as one code point
    expect(slugify('Cafe\u0301')).toBe('cafe\u0301'); // NFD: e + combining acute, one grapheme
    expect(slugify('ñame')).toBe('ñame');
  });

  it('drops emoji, including multi-scalar ones, without leaving a dash run', () => {
    expect(slugify('🎉 Party 🎉')).toBe('party');
    expect(slugify('👨‍👩‍👧 family')).toBe('family');
  });

  it("matches Swift's full-Unicode lowercasing", () => {
    // U+0130 lowercases to "i" + combining dot above in both languages.
    expect(slugify('\u0130stanbul')).toBe('i\u0307stanbul');
  });
});

// Typing a whole string one character at a time, the way the form actually
// gets used — a rule that only holds for a single onChange isn't the rule.
function type(field: { slug: string; touched: boolean }, name: string) {
  let f = field;
  for (let i = 1; i <= name.length; i++) f = slugForName(f, name.slice(0, i));
  return f;
}

describe('the slug field handover', () => {
  it('follows the name while untouched — the issue-256 case', () => {
    const f = type(EMPTY_SLUG_FIELD, 'Testing');
    expect(f.slug).toBe('testing');
    expect(f.touched).toBe(false);
  });

  it('keeps a manual edit even as the name keeps changing', () => {
    let f = type(EMPTY_SLUG_FIELD, 'Testing');
    f = slugEdited('my-own-slug');
    expect(f.touched).toBe(true);

    f = type(f, 'Testing Ground Rebuilt');
    expect(f.slug).toBe('my-own-slug'); // not "testing-ground-rebuilt"
  });

  it('re-arms derivation when the user clears the slug back to empty', () => {
    let f = slugEdited('my-own-slug');
    f = slugEdited(''); // backspaced it all out
    expect(f.touched).toBe(false);
    expect(f.slug).toBe(''); // does not snap back on the spot...

    f = slugForName(f, 'Testing'); // ...the next name keystroke picks it up
    expect(f.slug).toBe('testing');
  });

  it('treats a slug edited down to a single character as touched', () => {
    // The boundary of the rule above: only *empty* re-arms, not "short".
    const f = slugForName(slugEdited('x'), 'Testing');
    expect(f.slug).toBe('x');
  });

  it('leaves an untouched slug empty for an unsluggable name, keeping Create disabled', () => {
    const f = type(EMPTY_SLUG_FIELD, '!!!');
    expect(f.slug).toBe('');
    expect(f.touched).toBe(false);
  });
});
