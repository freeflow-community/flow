import { useRef, useState } from 'react';
import type { FileDTO } from '@mychat/shared';
import { emojiMatches } from '@mychat/shared';
import { uploadFile } from '../lib/api';
import { transformOutgoing } from '../lib/format';
import { decorate, domToText, getSelectionOffsets, rebuild, setCaretAt } from '../lib/composerDom';
import { useLive, useSelection } from '../state';
import { useMembers, useSendMessage } from '../hooks';
import EmojiPicker from './EmojiPicker';

export default function Composer({
  channelId,
  threadRootId,
  placeholder,
}: {
  channelId: string;
  threadRootId?: string;
  placeholder: string;
}) {
  const sel = useSelection();
  const live = useLive();
  const members = useMembers(sel.workspaceId);
  const send = useSendMessage(channelId);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<FileDTO[]>([]);
  const [uploading, setUploading] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Contenteditable editor (phase 3.5 item 2): the DOM is the source of truth
  // for the draft; `text` mirrors it (normalized to "\n" newlines) for the
  // autocomplete/send/disable logic below.
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const testPrefix = threadRootId ? 'thread-composer' : 'composer';

  /** After a native input event: mirror the DOM into state and restyle lines. */
  const syncFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    const value = domToText(el);
    decorate(el, value);
    setText(value);
    if (value) live.sendTyping(channelId);
  };

  /** Programmatic draft change: rebuild the editor DOM, park the caret, keep focus. */
  const setDraft = (value: string, caret: number = value.length) => {
    setText(value);
    const el = editorRef.current;
    if (!el) return;
    rebuild(el, value);
    el.focus();
    setCaretAt(el, Math.max(0, Math.min(caret, value.length)));
  };

  /** Splice text at the current selection (Shift+Enter newline, sanitized text paste). */
  const insertAtCaret = (insert: string) => {
    const el = editorRef.current;
    if (!el) return;
    const value = domToText(el);
    const [start, end] = getSelectionOffsets(el) ?? [value.length, value.length];
    setDraft(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    live.sendTyping(channelId);
  };

  // trailing-token autocomplete for @mentions and :shortcodes: — first match
  // pre-selected (Enter inserts), ↑/↓ move, Esc dismisses for this token.
  const [selIndex, setSelIndex] = useState(0);
  const [suppressedToken, setSuppressedToken] = useState<string | null>(null);
  const token = trailingToken(text);
  const suggestions = token && token !== suppressedToken ? buildSuggestions(token, members.data ?? []) : [];
  const selected = Math.min(selIndex, Math.max(0, suggestions.length - 1));

  const applySuggestion = (insert: string) => {
    if (!token) return;
    setDraft(text.slice(0, text.length - token.length) + insert);
    setSelIndex(0);
  };

  const doSend = () => {
    const raw = text.trim();
    if ((!raw && attachments.length === 0) || uploading > 0) return;
    const { body, mentions } = transformOutgoing(raw || ' ', members.data ?? []);
    send.mutate(
      {
        body,
        ...(threadRootId ? { threadRootId } : {}),
        fileIds: attachments.map((f) => f.id),
        mentions,
      },
      { onError: (err) => setError(err instanceof Error ? err.message : 'send failed') },
    );
    setDraft('');
    setAttachments([]);
    setError(null);
  };

  const pickFiles = async (files: FileList | File[] | null) => {
    if (!files || !sel.workspaceId) return;
    for (const file of Array.from(files)) {
      setUploading((v) => v + 1);
      try {
        const dto = await uploadFile(sel.workspaceId, file);
        setAttachments((prev) => (prev.length < 10 ? [...prev, dto] : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'upload failed');
      } finally {
        setUploading((v) => v - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // Image paste (phase 3.5 item 3): pasted images upload like picked files.
  // Everything else is spliced in as text/plain — no rich HTML can leak into
  // the editor even if "plaintext-only" is unsupported.
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (images.length > 0) {
      e.preventDefault();
      void pickFiles(
        images.map((f, i) => (f.name ? f : new File([f], `pasted-${Date.now() + i}.png`, { type: f.type }))),
      );
      return;
    }
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (pasted) insertAtCaret(pasted);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuppressedToken(token);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selected]!.insert);
        return;
      }
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) insertAtCaret('\n');
    else doSend();
  };

  // Drag-and-drop files anywhere on the composer → upload-then-attach.
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void pickFiles(e.dataTransfer.files);
  };

  return (
    <div className="relative px-[22px] pb-[22px]">
      {suggestions.length > 0 && (
        <div className="mc-scroll absolute bottom-full left-[22px] z-20 mb-1 flex max-h-56 min-w-48 flex-col overflow-y-auto rounded-lg border border-hairline bg-white p-1 shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.label}
              data-testid={`suggestion-${s.label}`}
              data-selected={i === selected}
              className={`rounded px-2 py-1 text-left text-sm ${i === selected ? 'bg-accent/10 font-semibold' : 'hover:bg-daypill'}`}
              onMouseEnter={() => setSelIndex(i)}
              onClick={() => applySuggestion(s.insert)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {(attachments.length > 0 || uploading > 0) && (
        <div className="mb-1 flex flex-wrap gap-1">
          {attachments.map((f) => (
            <span
              key={f.id}
              data-testid={`pending-file-${f.name}`}
              className="flex items-center gap-1 rounded-full bg-daypill px-2 py-0.5 text-xs"
            >
              {f.hasThumb ? '🖼' : '📄'} {f.name}
              <button className="text-faint hover:text-ink" onClick={() => setAttachments((p) => p.filter((x) => x.id !== f.id))}>
                ✕
              </button>
            </span>
          ))}
          {uploading > 0 && <span className="text-xs text-muted">Uploading…</span>}
        </div>
      )}

      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}

      <div
        className={`rounded-xl border bg-white px-3.5 py-3 focus-within:border-accent/40 ${dragOver ? 'border-accent' : 'border-hairline2'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div
          ref={editorRef}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          data-testid={`${testPrefix}-input`}
          data-placeholder={placeholder}
          className="mc-composer mc-scroll max-h-40 w-full overflow-y-auto text-sm outline-none"
          onInput={syncFromDom}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="mt-1.5 flex items-center gap-3 text-[15px] text-faint">
          <button
            data-testid={`${testPrefix}-attach`}
            className="hover:text-ink"
            title="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            ＋
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
          <button
            data-testid={`${testPrefix}-emoji`}
            className="hover:text-ink"
            title="Emoji"
            onClick={() => setShowEmoji((v) => !v)}
          >
            😊
          </button>
          <button
            className="hover:text-ink"
            title="Mention someone"
            onClick={() => setDraft(text + '@')}
          >
            @
          </button>
          <button
            data-testid={`${testPrefix}-send`}
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-send text-white disabled:opacity-40"
            title="Send"
            disabled={(!text.trim() && attachments.length === 0) || uploading > 0}
            onClick={doSend}
          >
            ➤
          </button>
        </div>
      </div>

      {showEmoji && (
        <div className="absolute right-[22px] bottom-full z-30 mb-1">
          <EmojiPicker
            onPick={(emoji) => {
              setShowEmoji(false);
              setDraft(text + emoji);
            }}
            onClose={() => setShowEmoji(false)}
          />
        </div>
      )}
    </div>
  );
}

function trailingToken(text: string): string | null {
  const m = text.match(/(?:^|\s)([@:][^\s@]*)$/);
  const tok = m?.[1];
  if (!tok || tok.length < 2) return null;
  return tok;
}

function buildSuggestions(
  token: string,
  members: { userId: string; displayName: string }[],
): { label: string; insert: string }[] {
  const query = token.slice(1).toLowerCase();
  if (token.startsWith('@')) {
    const groups = ['channel', 'here', 'everyone']
      .filter((g) => g.startsWith(query))
      .map((g) => ({ label: `@${g}`, insert: `@${g} ` }));
    const users = members
      .filter((m) => m.displayName.toLowerCase().startsWith(query))
      .slice(0, 6)
      .map((m) => ({ label: `@${m.displayName}`, insert: `@${m.displayName} ` }));
    return [...groups, ...users].slice(0, 8);
  }
  return emojiMatches(query).map((e) => ({ label: `${e.emoji} :${e.code}:`, insert: `${e.emoji} ` }));
}
