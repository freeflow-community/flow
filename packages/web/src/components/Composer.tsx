import { useEffect, useRef, useState } from 'react';
import type { FileDTO, MessageDTO } from '@flow/shared';
import { emojiMatches } from '@flow/shared';
import { api, uploadFile } from '../lib/api';
import { transformOutgoing } from '../lib/format';
import { decorate, domToText, getSelectionOffsets, rebuild, setCaretAt } from '../lib/composerDom';
import { useLive, useSelection } from '../state';
import { useChannelMembers, useChannels, useMembers, useSendMessage } from '../hooks';
import { useQueryClient } from '@tanstack/react-query';
import { AuthImg } from './Avatar';
import EmojiPicker from './EmojiPicker';
import { AgentMarkIcon, CheckIcon, CloseIcon, DocIcon, PlusIcon, SendIcon, SmileIcon } from './icons';

export default function Composer({
  channelId,
  threadRootId,
  placeholder,
  onArrowUpEdit,
  editingMessage,
}: {
  channelId: string;
  threadRootId?: string;
  placeholder: string;
  /** ↑ in an empty composer starts editing the caller's last message when it
   * is the newest in this channel/thread (ui_nits item 4, Slack semantics). */
  onArrowUpEdit?: (() => void) | undefined;
  /** The message being edited when it belongs to this composer's channel/thread.
   * Editing reuses the prompt editor (ui_nits) rather than an inline box: the
   * body loads here, Enter saves via PATCH, Esc/Cancel restores the draft. */
  editingMessage?: MessageDTO | undefined;
}) {
  const sel = useSelection();
  const live = useLive();
  const qc = useQueryClient();
  const members = useMembers(sel.workspaceId);
  const channels = useChannels(sel.workspaceId);
  const channelMembers = useChannelMembers(channelId);
  const send = useSendMessage(channelId);
  // Mention-of-non-member CTA (Slack semantics): after sending an @mention of
  // someone outside a standard channel, offer to add them.
  const [missingMentions, setMissingMentions] = useState<string[]>([]);
  const [addedNotice, setAddedNotice] = useState<string | null>(null);
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
    if (maybeAutoCloseFence(el, value)) return; // rebuilt via setDraft
    decorate(el, value);
    setText(value);
    if (value) live.sendTyping(channelId, threadRootId);
  };

  /** Typing the third backtick of a new opening fence turns it into an
   * enterable code block: closing fence inserted, caret parked inside. */
  const maybeAutoCloseFence = (el: HTMLDivElement, value: string): boolean => {
    const off = getSelectionOffsets(el);
    if (!off || off[0] !== off[1]) return false;
    const caret = off[0];
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const nl = value.indexOf('\n', caret);
    const lineEnd = nl === -1 ? value.length : nl;
    if (value.slice(lineStart, lineEnd) !== '```' || caret !== lineEnd) return false;
    const isFenceLine = (l: string) => l.trimStart().startsWith('```');
    const fencesBefore = value.slice(0, lineStart).split('\n').filter(isFenceLine).length;
    if (fencesBefore % 2 === 1) return false; // this closes an existing block
    if (value.slice(lineEnd).split('\n').some(isFenceLine)) return false;
    setDraft(value.slice(0, lineEnd) + '\n\n```' + value.slice(lineEnd), caret + 1);
    live.sendTyping(channelId, threadRootId);
    return true;
  };

  /** Escape/Backspace inside a code block with no content removes the block. */
  const removeEmptyFenceBlock = (): boolean => {
    const el = editorRef.current;
    if (!el) return false;
    const off = getSelectionOffsets(el);
    if (!off || off[0] !== off[1]) return false;
    const caret = off[0];
    const lines = text.split('\n');
    // classify lines and find offsets
    let inCode = false;
    let pos = 0;
    let openStart = -1;
    let lineNo = 0;
    let region: { start: number; end: number; interior: string } | null = null;
    let interior = '';
    for (const line of lines) {
      const end = pos + line.length;
      const isFence = line.trimStart().startsWith('```');
      if (isFence && !inCode) {
        inCode = true;
        openStart = pos;
        interior = '';
      } else if (isFence && inCode) {
        inCode = false;
        if (caret >= openStart && caret <= end + 1) {
          region = { start: openStart, end: Math.min(text.length, end + 1), interior };
          break;
        }
      } else if (inCode) {
        interior += line;
      }
      pos = end + 1;
      lineNo += 1;
    }
    if (!region && inCode && caret >= openStart) {
      region = { start: openStart, end: text.length, interior }; // unclosed
    }
    if (!region || region.interior.trim() !== '') return false;
    setDraft(text.slice(0, region.start) + text.slice(region.end), region.start);
    return true;
  };

  /** Caret's interior-code-line context, or null when not on a code line. */
  const codeCaret = (): {
    caret: number; lineStart: number; lineEnd: number; empty: boolean;
    nextIsClose: boolean; closeEnd: number | null;
  } | null => {
    const el = editorRef.current;
    const off = el ? getSelectionOffsets(el) : null;
    if (!off || off[0] !== off[1]) return null;
    const caret = off[0];
    const lines = text.split('\n');
    let inCode = false;
    let pos = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const end = pos + line.length;
      if (line.trimStart().startsWith('```')) inCode = !inCode;
      else if (inCode && caret >= pos && caret <= end) {
        const next = lines[li + 1];
        const nextIsClose = next !== undefined && next.trimStart().startsWith('```');
        return {
          caret, lineStart: pos, lineEnd: end, empty: line.trim() === '',
          nextIsClose, closeEnd: nextIsClose ? end + 1 + next.length : null,
        };
      }
      pos = end + 1;
    }
    return null;
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

  // Editing reuses this prompt editor (ui_nits). Entering edit mode stashes the
  // in-progress draft and loads the message body; leaving it restores the draft.
  const editingId = editingMessage?.id ?? null;
  const stashedDraft = useRef('');
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editingId && editingMessage) {
      if (!wasEditing.current) stashedDraft.current = text;
      wasEditing.current = true;
      setDraft(editingMessage.body);
    } else if (wasEditing.current) {
      wasEditing.current = false;
      setDraft(stashedDraft.current);
      stashedDraft.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /** Splice text at the current selection (Shift+Enter newline, sanitized text paste). */
  const insertAtCaret = (insert: string) => {
    const el = editorRef.current;
    if (!el) return;
    const value = domToText(el);
    const [start, end] = getSelectionOffsets(el) ?? [value.length, value.length];
    setDraft(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    live.sendTyping(channelId, threadRootId);
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

  const doSend = (override?: string) => {
    const raw = (override ?? text).trim();
    // Editing an existing message: PATCH in place (body is already in stored
    // token form), then leave edit mode — the effect restores the stashed draft.
    // An emptied edit just cancels (no delete), matching the prior inline editor.
    if (editingId) {
      if (raw) void api('PATCH', `/v1/messages/${editingId}`, { body: raw });
      sel.setEditingMessage(null);
      return;
    }
    if ((!raw && attachments.length === 0) || uploading > 0) return;
    const { body, mentions } = transformOutgoing(raw || ' ', members.data ?? []);
    // Detect @mentions of users who aren't in this standard channel; the CTA
    // banner renders above the composer after the send.
    const chanKind = channels.data?.find((c) => c.id === channelId)?.kind;
    if (chanKind === 'standard' && channelMembers.data) {
      const missing = mentions.filter((id) => !channelMembers.data.includes(id));
      setMissingMentions(missing);
    }
    setAddedNotice(null);
    // A send failure no longer surfaces here — the optimistic row stays put
    // and shows its own "Failed to send · Retry" affordance in the stream.
    send.mutate({
      body,
      ...(threadRootId ? { threadRootId } : {}),
      fileIds: attachments.map((f) => f.id),
      mentions,
      files: attachments, // full DTOs so the optimistic row renders previews
    });
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
    if (e.key === 'Escape' && editingId) {
      e.preventDefault();
      sel.setEditingMessage(null); // leave edit mode; effect restores the draft
      return;
    }
    if (e.key === 'ArrowUp' && !text && onArrowUpEdit) {
      e.preventDefault();
      onArrowUpEdit();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (removeEmptyFenceBlock()) {
        e.preventDefault();
        return;
      }
    }
    const ctx = codeCaret();
    // → at the end of the code content exits the block onto a plain line.
    if (e.key === 'ArrowRight' && ctx && ctx.caret === ctx.lineEnd && ctx.nextIsClose) {
      e.preventDefault();
      if (ctx.closeEnd! >= text.length) setDraft(text + '\n');
      else if (editorRef.current) setCaretAt(editorRef.current, ctx.closeEnd! + 1);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) {
      insertAtCaret('\n');
    } else if (ctx) {
      if (ctx.empty) {
        // Return on an empty code line: drop the line and submit.
        const cleaned = text.slice(0, ctx.lineStart) + text.slice(Math.min(text.length, ctx.lineEnd + 1));
        setDraft(cleaned);
        doSend(cleaned);
      } else {
        insertAtCaret('\n');
      }
    } else {
      doSend();
    }
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
              <span className="flex items-center gap-1.5">
                {s.label}
                {s.isAgent && (
                  <span className="inline-flex text-accent-soft" title="AI agent">
                    <AgentMarkIcon size={10} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {missingMentions.length > 0 && (
        <div
          data-testid="mention-nonmember-cta"
          className="mb-1.5 flex items-center justify-between gap-3 rounded-lg border border-hairline bg-daypill/50 px-3 py-2 text-sm"
        >
          <span>
            {missingMentions
              .map((id) => {
                const m = (members.data ?? []).find((x) => x.userId === id);
                return m?.displayName ?? 'They';
              })
              .join(', ')}{' '}
            {missingMentions.length === 1 ? 'is' : 'are'} not in this channel and won&rsquo;t see your mention.
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              data-testid="mention-cta-add"
              className="rounded bg-accent px-2.5 py-1 text-xs font-semibold text-white"
              onClick={() => {
                void (async () => {
                  const ids = missingMentions;
                  setMissingMentions([]);
                  try {
                    for (const userId of ids) await api('POST', `/v1/channels/${channelId}/members`, { userId });
                    await qc.invalidateQueries({ queryKey: ['channelMembers', channelId] });
                    setAddedNotice('Added to the channel — mention them again to get their attention.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'could not add to channel');
                  }
                })();
              }}
            >
              Add to channel
            </button>
            <button
              data-testid="mention-cta-dismiss"
              className="rounded px-2 py-1 text-xs text-faint hover:bg-daypill"
              onClick={() => setMissingMentions([])}
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
      {addedNotice && (
        <p data-testid="mention-cta-added" className="mb-1.5 px-1 text-xs text-muted">
          {addedNotice}
        </p>
      )}

      {(attachments.length > 0 || uploading > 0) && (
        <div className="mb-1 flex flex-wrap items-end gap-1.5">
          {attachments.map((f) =>
            f.hasThumb ? (
              // Image previews in the prompt area (phase 5 item 4): real thumbnail + ✕ overlay.
              <span key={f.id} data-testid={`pending-file-${f.name}`} className="relative" title={f.name}>
                <AuthImg
                  path={`/v1/files/${f.id}/thumb`}
                  alt={f.name}
                  className="h-14 w-14 rounded-lg border border-hairline object-cover"
                />
                <button
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-white text-[9px] text-faint shadow-sm hover:text-ink"
                  title="Remove"
                  onClick={() => setAttachments((p) => p.filter((x) => x.id !== f.id))}
                >
                  <CloseIcon size={9} />
                </button>
              </span>
            ) : (
              <span
                key={f.id}
                data-testid={`pending-file-${f.name}`}
                className="flex items-center gap-1 rounded-full bg-daypill px-2 py-0.5 text-xs"
              >
                <span className="text-ink-soft"><DocIcon size={13} /></span>
                {f.name}
                <button className="flex items-center text-faint hover:text-ink" onClick={() => setAttachments((p) => p.filter((x) => x.id !== f.id))}>
                  <CloseIcon size={11} />
                </button>
              </span>
            ),
          )}
          {uploading > 0 && <span className="text-xs text-muted">Uploading…</span>}
        </div>
      )}

      {editingId && (
        <div
          data-testid={`${testPrefix}-editing-banner`}
          className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted"
        >
          <span>Editing message</span>
          <span className="text-faint">·</span>
          <button
            data-testid={`${testPrefix}-editing-cancel`}
            className="font-semibold text-accent-soft hover:underline"
            onClick={() => sel.setEditingMessage(null)}
          >
            Cancel
          </button>
          <span className="text-faint">· Enter to save · Esc to cancel</span>
        </div>
      )}

      {error && <p className="mb-1 text-xs text-red-600">{error}</p>}

      <div
        className={`rounded-xl border bg-white px-3.5 py-3 focus-within:border-accent/40 ${dragOver ? 'border-accent' : 'border-hairline2'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        // Clicking anywhere on the card (padding, whitespace) focuses the
        // input; buttons and the editor keep their own click handling.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, [contenteditable]')) return;
          const el = editorRef.current;
          if (el && document.activeElement !== el) {
            el.focus();
            setCaretAt(el, domToText(el).length);
          }
        }}
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
        <div className="mt-1.5 flex items-center gap-1.5 text-ink-soft">
          <button
            data-testid={`${testPrefix}-attach`}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-daypill hover:text-ink"
            title="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            <PlusIcon size={15} />
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
          <button
            data-testid={`${testPrefix}-emoji`}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-daypill hover:text-ink"
            title="Emoji"
            onClick={() => setShowEmoji((v) => !v)}
          >
            <SmileIcon size={15} />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-[15px] font-medium hover:bg-daypill hover:text-ink"
            title="Mention someone"
            onClick={() => setDraft(text + '@')}
          >
            @
          </button>
          <button
            data-testid={`${testPrefix}-send`}
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-full bg-send text-white transition-[transform,opacity] duration-150 ease-out-quart enabled:hover:bg-accent-deep enabled:active:scale-90 disabled:opacity-35"
            title={editingId ? 'Save edit' : 'Send'}
            disabled={editingId ? !text.trim() : (!text.trim() && attachments.length === 0) || uploading > 0}
            onClick={() => doSend()}
          >
            {editingId ? <CheckIcon size={14} /> : <SendIcon size={14} />}
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

/** onArrowUpEdit builder (ui_nits item 4): defined only when the caller's own
 * message is the newest in the list — Slack semantics. */
export function arrowUpEdit(
  messages: MessageDTO[],
  userId: string,
  setEditingMessage: (id: string | null) => void,
): (() => void) | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.userId !== userId || last.deletedAt) return undefined;
  return () => setEditingMessage(last.id);
}

function trailingToken(text: string): string | null {
  const m = text.match(/(?:^|\s)([@:][^\s@]*)$/);
  const tok = m?.[1];
  if (!tok || tok.length < 2) return null;
  return tok;
}

function buildSuggestions(
  token: string,
  members: { userId: string; displayName: string; isAgent?: boolean }[],
): { label: string; insert: string; isAgent?: boolean }[] {
  const query = token.slice(1).toLowerCase();
  if (token.startsWith('@')) {
    const groups = ['channel', 'here', 'everyone']
      .filter((g) => g.startsWith(query))
      .map((g) => ({ label: `@${g}`, insert: `@${g} ` }));
    const users = members
      .filter((m) => m.displayName.toLowerCase().startsWith(query))
      .slice(0, 6)
      // agents get the agent mark in the popup label; the insert stays the plain name
      .map((m) => ({ label: `@${m.displayName}`, insert: `@${m.displayName} `, isAgent: m.isAgent }));
    return [...groups, ...users].slice(0, 8);
  }
  return emojiMatches(query).map((e) => ({ label: `${e.emoji} :${e.code}:`, insert: `${e.emoji} ` }));
}
