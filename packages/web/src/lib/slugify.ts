// Workspace-slug derivation (issue #256). This is a port, not a new rule: the
// two native clients have shipped it since their create-workspace forms
// existed, and web was the only one making you type the slug by hand.
//
// MUST STAY IN STEP WITH:
//   apps/macos/Sources/Flow/Views/WorkspaceSwitcherView.swift  (CreateWorkspaceSheet.slugify)
//   apps/ios/Sources/Views/SidebarDrawer.swift                 (AddWorkspaceSheet.slugify)
//
// Those two are byte-identical to each other and cannot share code with this
// one — they're Swift, this is TypeScript, and there is no build boundary
// between them. So the three copies are kept honest by this comment and by
// slugify.test.ts, whose cases are written against the Swift semantics rather
// than against whatever this implementation happens to do.

// Swift maps over `Character`s — grapheme clusters, not code points — so a
// letter carrying a combining mark ("e" + U+0301) survives as one letter
// rather than becoming "e-". Segmenting the same way is what makes decomposed
// text (which macOS hands out freely) slugify identically on all three
// clients. Everything else collapses to the same answer either way, because
// runs of "-" are collapsed a line later.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The workspace slug for a name: lowercase, every non-alphanumeric becomes
 * `-`, runs of `-` collapse, leading and trailing `-` are trimmed.
 *
 * A name with nothing alphanumeric in it ("!!!", "   ") yields `''` — the
 * caller is expected to keep Create disabled on an empty slug, exactly as the
 * native clients do.
 *
 * Mirrors Swift's `Character.isLetter || .isNumber`, which is Unicode general
 * category L* or N* — so accented letters, Cyrillic, CJK and non-ASCII digits
 * are all kept, not stripped.
 */
export function slugify(name: string): string {
  let out = '';
  for (const { segment } of graphemes.segment(name.toLowerCase())) {
    out += /^[\p{L}\p{N}]/u.test(segment) ? segment : '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The slug field of a create-workspace form, and whether the user has taken it
 * over. Kept out of the component so the handover rule can be tested directly
 * — it's the part of this feature with actual states in it, and a derived
 * field that overwrites the user's own typing is a worse bug than no
 * derivation at all.
 */
export type SlugField = { slug: string; touched: boolean };

export const EMPTY_SLUG_FIELD: SlugField = { slug: '', touched: false };

/** The user typed in the *name* field. Derive, unless they've taken over. */
export function slugForName(field: SlugField, name: string): SlugField {
  return field.touched ? field : { slug: slugify(name), touched: false };
}

/**
 * The user typed in the *slug* field. From here the name no longer drives it.
 *
 * Clearing the slug back to empty re-arms derivation, rather than latching
 * "touched" forever: an empty slug is indistinguishable from one never filled
 * in, Create is disabled either way, and it gives an obvious way back to the
 * automatic slug without closing and reopening the form. Note that it re-arms
 * rather than *immediately* re-deriving — snapping the text back the instant
 * you delete the last character would read as a field refusing to be cleared.
 * The next keystroke in the name field picks it up again.
 */
export function slugEdited(slug: string): SlugField {
  return { slug, touched: slug !== '' };
}
