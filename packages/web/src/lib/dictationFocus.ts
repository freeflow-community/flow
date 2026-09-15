export interface FocusableEditor {
  readonly isContentEditable: boolean;
  focus(): void;
}

/**
 * Focus the editor once dictation hands it back. The composer makes its editor
 * non-editable while capturing, and a non-editable div cannot take focus — so
 * focusing inside the session-end callback, before React re-renders the
 * editor as contentEditable, leaves focus on the Stop button. Request here,
 * then flush from a layout effect after the editor is editable again.
 */
export function createDeferredEditorFocus<T extends FocusableEditor>(placeCaret: (el: T, caret: number) => void) {
  let pending: number | null = null;
  return {
    request(caret: number) {
      pending = caret;
    },
    cancel() {
      pending = null;
    },
    /** Returns true when focus moved to the editor. */
    flush(el: T | null): boolean {
      if (pending === null || !el || !el.isContentEditable) return false;
      const caret = pending;
      pending = null;
      el.focus();
      placeCaret(el, caret);
      return true;
    },
  };
}
