import { describe, expect, it, vi } from 'vitest';
import { createDeferredEditorFocus } from './dictationFocus';

function editor(editable: boolean) {
  return { isContentEditable: editable, focus: vi.fn() };
}

describe('createDeferredEditorFocus', () => {
  it('waits until the editor is editable again before focusing', () => {
    const place = vi.fn();
    const focus = createDeferredEditorFocus(place);
    const el = editor(false);
    focus.request(7);
    // Session-end callback time: React has not restored contentEditable yet.
    expect(focus.flush(el)).toBe(false);
    expect(el.focus).not.toHaveBeenCalled();
    el.isContentEditable = true;
    expect(focus.flush(el)).toBe(true);
    expect(el.focus).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledWith(el, 7);
  });

  it('focuses once per request', () => {
    const focus = createDeferredEditorFocus(() => {});
    const el = editor(true);
    focus.request(0);
    focus.flush(el);
    expect(focus.flush(el)).toBe(false);
    expect(el.focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing after cancel or without an editor', () => {
    const focus = createDeferredEditorFocus(() => {});
    const el = editor(true);
    focus.request(0);
    expect(focus.flush(null)).toBe(false);
    focus.cancel();
    expect(focus.flush(el)).toBe(false);
    expect(el.focus).not.toHaveBeenCalled();
  });
});
