import { useRef, useState } from 'react';
import type { FileDTO } from '@mychat/shared';
import { emojiMatches } from '@mychat/shared';
import { uploadFile } from '../lib/api';
import { transformOutgoing } from '../lib/format';
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const testPrefix = threadRootId ? 'thread-composer' : 'composer';

  // trailing-token autocomplete for @mentions and :shortcodes:
  const token = trailingToken(text);
  const suggestions = token ? buildSuggestions(token, members.data ?? []) : [];

  const applySuggestion = (insert: string) => {
    if (!token) return;
    setText(text.slice(0, text.length - token.length) + insert);
    inputRef.current?.focus();
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
    setText('');
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

  // Image paste (phase 3.5 item 3): pasted images upload like picked files;
  // text-only pastes fall through untouched.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (images.length === 0) return;
    e.preventDefault();
    void pickFiles(
      images.map((f, i) => (f.name ? f : new File([f], `pasted-${Date.now() + i}.png`, { type: f.type }))),
    );
  };

  return (
    <div className="relative px-[22px] pb-[22px]">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-[22px] z-20 mb-1 flex gap-1 rounded-lg border border-hairline bg-white p-1 shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.label}
              data-testid={`suggestion-${s.label}`}
              className="rounded px-2 py-1 text-sm hover:bg-daypill"
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

      <div className="rounded-xl border border-hairline2 bg-white px-3.5 py-3 focus-within:border-accent/40">
        <textarea
          ref={inputRef}
          data-testid={`${testPrefix}-input`}
          className="max-h-40 w-full resize-none bg-transparent text-sm outline-none placeholder:text-faint"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) live.sendTyping(channelId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              doSend();
            }
          }}
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
            onClick={() => { setText((t) => t + '@'); inputRef.current?.focus(); }}
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
              setText((t) => t + emoji);
              inputRef.current?.focus();
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
