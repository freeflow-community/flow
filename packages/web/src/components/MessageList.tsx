import { useEffect, useRef, useState } from 'react';
import type { FileDTO, MessageDTO, WorkspaceMemberDTO } from '@flow/shared';
import { api, blobUrl, fileText } from '../lib/api';
import { bytesLabel, displayTime, renderBlocks } from '../lib/format';
import { useAuth, useSelection } from '../state';
import { useToggleReaction } from '../hooks';
import { Avatar, AuthImg } from './Avatar';
import EmojiPicker from './EmojiPicker';

export default function MessageList({
  messages,
  names,
  membersById = {},
  hasMore,
  onLoadOlder,
  showThreadAffordances,
}: {
  messages: MessageDTO[];
  names: Record<string, string>;
  membersById?: Record<string, WorkspaceMemberDTO>;
  hasMore: boolean;
  onLoadOlder: () => void;
  showThreadAffordances: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [lastId]);

  return (
    <div className="mc-scroll min-h-0 flex-1 overflow-y-auto py-2" data-testid="message-list">
      {hasMore && (
        <div className="py-1 text-center">
          <button className="text-sm font-semibold text-accent-soft hover:underline" onClick={onLoadOlder}>
            Load earlier messages
          </button>
        </div>
      )}
      {messages.map((m, i) => (
        <div key={m.id}>
          {startsNewDay(messages, i) && <DayDivider iso={m.createdAt} />}
          <MessageRow
            message={m}
            names={names}
            membersById={membersById}
            showHeader={showsHeader(messages, i)}
            showThreadAffordances={showThreadAffordances}
          />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function showsHeader(messages: MessageDTO[], index: number): boolean {
  if (index === 0) return true;
  if (startsNewDay(messages, index)) return true;
  const prev = messages[index - 1]!;
  const cur = messages[index]!;
  if (prev.userId !== cur.userId) return true;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > 300_000;
}

function startsNewDay(messages: MessageDTO[], index: number): boolean {
  if (index === 0) return true;
  return (
    new Date(messages[index - 1]!.createdAt).toDateString() !==
    new Date(messages[index]!.createdAt).toDateString()
  );
}

function DayDivider({ iso }: { iso: string }) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const label =
    d.toDateString() === now.toDateString()
      ? 'Today'
      : d.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : d.toLocaleDateString([], { month: 'long', day: 'numeric' });
  return (
    <div className="my-2 text-center">
      <span className="rounded-[20px] bg-daypill px-3 py-[3px] text-[11px] text-faint">{label}</span>
    </div>
  );
}

/** "12m ago" style label for thread indicators. */
function relTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function MessageRow({
  message,
  names,
  membersById,
  showHeader,
  showThreadAffordances,
}: {
  message: MessageDTO;
  names: Record<string, string>;
  membersById: Record<string, WorkspaceMemberDTO>;
  showHeader: boolean;
  showThreadAffordances: boolean;
}) {
  const auth = useAuth();
  const sel = useSelection();
  const toggle = useToggleReaction();
  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const mine = message.userId === auth.user.id;
  const sender = names[message.userId] ?? 'Unknown';
  const member = membersById[message.userId];

  const saveEdit = async () => {
    const body = editText.trim();
    if (body) await api('PATCH', `/v1/messages/${message.id}`, { body });
    setEditing(false);
  };

  return (
    <div
      data-testid={`message-${message.id}`}
      className={`group relative flex gap-2.5 px-[22px] hover:bg-daypill/40 ${showHeader ? 'mt-3' : 'py-px'}`}
    >
      <div className="w-[38px] shrink-0">
        {showHeader && (
          <Avatar userId={message.userId} name={sender} avatarUrl={member?.avatarUrl} size={38} radius={11} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold">
              {sender}
              {member?.statusEmoji && (
                <span className="ml-1 text-sm font-normal" title={member.statusText} data-testid={`status-of-${sender}`}>
                  {member.statusEmoji}
                </span>
              )}
            </span>
            <span className="text-[11px] text-faint">{displayTime(message.createdAt)}</span>
          </div>
        )}

        {message.deletedAt ? (
          <p className="text-sm text-faint italic">This message was deleted</p>
        ) : editing ? (
          <div className="flex gap-2 py-1">
            <input
              className="flex-1 rounded border border-hairline2 bg-white px-2 py-1 text-sm"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
            />
            <button className="text-sm font-semibold text-accent-soft" onClick={() => void saveEdit()}>Save</button>
            <button className="text-sm text-muted" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <>
            {message.body.trim() && (
              <div className="text-sm leading-normal break-words whitespace-pre-wrap">
                {renderBlocks(message.body, names, auth.user.id)}
                {message.editedAt && <span className="ml-1 text-xs text-faint">(edited)</span>}
              </div>
            )}
            {message.files.map((f) => (
              <Attachment key={f.id} file={f} />
            ))}
            {message.reactions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {message.reactions.map((r) => {
                  const mineR = r.userIds.includes(auth.user.id);
                  return (
                    <button
                      key={r.emoji}
                      data-testid={`reaction-${r.emoji}`}
                      data-count={r.count}
                      data-mine={mineR}
                      title={r.userIds.map((id) => names[id] ?? '?').join(', ')}
                      className={`rounded-[20px] border bg-white px-[9px] py-[2px] text-xs ${
                        mineR ? 'border-accent-soft/40' : 'border-hairline hover:border-hairline2'
                      }`}
                      onClick={() => toggle.mutate({ message, emoji: r.emoji, mine: mineR })}
                    >
                      {r.emoji}{' '}
                      <span className={`font-bold ${mineR ? 'text-accent-soft' : 'text-ink-soft'}`}>{r.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {showThreadAffordances && message.replyCount > 0 && (
          <button
            data-testid={`thread-open-${message.id}`}
            className="mt-1 flex items-center gap-2 rounded-[10px] border border-hairline bg-white py-[5px] pr-2.5 pl-1.5 text-xs hover:border-hairline2"
            onClick={() => sel.openThread(message.id)}
          >
            {(message.replyParticipantUserIds ?? []).length > 0 && (
              <span className="flex -space-x-1.5" data-testid={`thread-participants-${message.id}`}>
                {message.replyParticipantUserIds.map((id) => (
                  <Avatar
                    key={id}
                    userId={id}
                    name={names[id] ?? 'Unknown'}
                    avatarUrl={membersById[id]?.avatarUrl}
                    size={20}
                    radius={6}
                    className="ring-2 ring-white"
                  />
                ))}
              </span>
            )}
            <span className="font-[650] text-accent-soft">
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </span>
            {message.lastReplyAt && <span className="text-[11px] text-faint">Last reply {relTime(message.lastReplyAt)}</span>}
          </button>
        )}
      </div>

      {!message.deletedAt && !editing && (
        <div className="absolute top-0 right-[22px] hidden gap-1 rounded-lg border border-hairline bg-white px-1 shadow-sm group-hover:flex">
          <button
            data-testid={`add-reaction-${message.id}`}
            className="px-1 text-sm hover:bg-daypill"
            title="Add reaction"
            onClick={() => setShowPicker(true)}
          >
            🙂
          </button>
          {showThreadAffordances && (
            <button
              className="px-1 text-sm hover:bg-daypill"
              title="Reply in thread"
              onClick={() => sel.openThread(message.threadRootId ?? message.id)}
            >
              💬
            </button>
          )}
          {mine && (
            <>
              <button
                className="px-1 text-sm hover:bg-daypill"
                title="Edit"
                onClick={() => { setEditText(message.body); setEditing(true); }}
              >
                ✏️
              </button>
              <button
                className="px-1 text-sm hover:bg-daypill"
                title="Delete"
                onClick={() => void api('DELETE', `/v1/messages/${message.id}`)}
              >
                🗑
              </button>
            </>
          )}
        </div>
      )}

      {showPicker && (
        <div className="absolute top-6 right-[22px] z-30">
          <EmojiPicker
            onPick={(emoji) => {
              setShowPicker(false);
              const mineR = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(auth.user.id) ?? false;
              toggle.mutate({ message, emoji, mine: mineR });
            }}
            onClose={() => setShowPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

// Collapsed-image state (phase 5 ruling): persisted per device, capped list.
const COLLAPSE_KEY = 'flow.collapsedImages';
const COLLAPSE_CAP = 500;
function collapsedIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function persistCollapsed(fileId: string, collapsed: boolean): void {
  const ids = collapsedIds().filter((id) => id !== fileId);
  if (collapsed) ids.push(fileId);
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids.slice(-COLLAPSE_CAP)));
}

/** ASCII-ish formats that get an inline monospace preview (phase 6). */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'swift', 'kt',
  'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml',
  'html', 'htm', 'css', 'scss', 'less', 'sql', 'csv', 'tsv', 'env', 'gitignore',
]);
const TEXT_MIMES = new Set([
  'application/json', 'application/javascript', 'application/xml',
  'application/x-sh', 'application/x-yaml',
]);
function isTextFile(file: FileDTO): boolean {
  if (file.mimeType.startsWith('text/') || TEXT_MIMES.has(file.mimeType)) return true;
  return TEXT_EXTS.has(file.name.split('.').pop()?.toLowerCase() ?? '');
}

const TEXT_PREVIEW_LINES = 10;
const TEXT_EXPAND_MAX = 100_000; // chars shown when expanded (phase 6 ruling)

function useCollapsed(fileId: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => collapsedIds().includes(fileId));
  const toggle = () =>
    setCollapsed((c) => {
      persistCollapsed(fileId, !c);
      return !c;
    });
  return [collapsed, toggle];
}

function useDownload(file: FileDTO): () => Promise<void> {
  return async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };
}

function CardHeader({
  file,
  collapsed,
  onToggle,
}: {
  file: FileDTO;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[11px] text-faint">
      <button
        data-testid={`file-collapse-${file.name}`}
        className="w-4 hover:text-ink"
        title={collapsed ? 'Show preview' : 'Hide preview'}
        onClick={onToggle}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      <span className="truncate">{file.name}</span>
    </div>
  );
}

function DownloadHoverButton({ file, onDownload }: { file: FileDTO; onDownload: () => Promise<void> }) {
  return (
    <button
      data-testid={`file-download-${file.name}`}
      className="absolute top-1.5 right-1.5 z-10 hidden h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white/90 text-sm shadow-sm hover:bg-white group-hover/att:flex"
      title="Download"
      onClick={() => void onDownload()}
    >
      ⤓
    </button>
  );
}

function Attachment({ file }: { file: FileDTO }) {
  if (file.hasThumb) return <ImageAttachment file={file} />;
  if (file.mimeType === 'application/pdf') return <PdfAttachment file={file} />;
  if (isTextFile(file)) return <TextAttachment file={file} />;
  return <FileChip file={file} />;
}

function ImageAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [lightbox, setLightbox] = useState(false);
  const download = useDownload(file);

  // GIFs skip the static webp thumb and render the original so they animate.
  const imgPath = file.mimeType === 'image/gif' ? `/v1/files/${file.id}` : `/v1/files/${file.id}/thumb`;
  return (
    <div className="mt-1">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="group/att relative mt-0.5 w-fit">
          <button data-testid={`file-${file.name}`} className="block" onClick={() => setLightbox(true)} title={file.name}>
            <AuthImg path={imgPath} alt={file.name} className="max-h-60 max-w-72 rounded-lg border border-hairline" />
          </button>
          <DownloadHoverButton file={file} onDownload={download} />
        </div>
      )}
      {lightbox && <ImageLightbox file={file} onClose={() => setLightbox(false)} onDownload={download} />}
    </div>
  );
}

/** Inline monospace preview for text-ish files (phase 6): first lines +
 * Expand, expanded output capped with a visible truncation notice. */
function TextAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const download = useDownload(file);

  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`)
      .then((t) => { if (alive) setText(t); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);

  if (failed) return <FileChip file={file} />;

  const lines = text === null ? [] : text.split('\n');
  const preview = lines.slice(0, TEXT_PREVIEW_LINES).join('\n');
  const canExpand = text !== null && text.length > preview.length;
  const expandTruncated = text !== null && text.length > TEXT_EXPAND_MAX;
  const shown = text === null ? 'Loading…' : expanded ? text.slice(0, TEXT_EXPAND_MAX) : preview;

  return (
    <div className="mt-1 max-w-[560px]">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="mt-0.5">
          <div className="group/att relative">
            <pre
              data-testid={`file-text-${file.name}`}
              className="mc-scroll overflow-x-auto rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre text-ink"
            >
              {shown}
            </pre>
            <DownloadHoverButton file={file} onDownload={download} />
          </div>
          {expanded && expandTruncated && (
            <p className="mt-0.5 text-[11px] text-faint">Showing the first 100 KB — download for the full file.</p>
          )}
          {canExpand && (
            <button
              data-testid={`file-text-expand-${file.name}`}
              className="mt-0.5 text-xs font-semibold text-accent-soft hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Collapse ▴' : 'Expand ▾'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Mid-size PDF preview via the browser's native renderer (phase 6 ruling:
 * no pdf.js dependency); click opens the in-app full reader. */
function PdfAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [url, setUrl] = useState<string | null>(null);
  const [reader, setReader] = useState(false);
  const download = useDownload(file);

  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [file.id]);

  return (
    <div className="mt-1">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="group/att relative mt-0.5 h-[400px] w-[320px]">
          {url ? (
            <embed
              src={`${url}#toolbar=0&navpanes=0`}
              type="application/pdf"
              className="h-full w-full rounded-lg border border-hairline"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-lg border border-hairline bg-white text-xs text-faint">
              Loading…
            </div>
          )}
          {/* the embed swallows clicks — a transparent overlay opens the reader */}
          <button
            data-testid={`file-${file.name}`}
            className="absolute inset-0 cursor-pointer"
            title={`Open ${file.name}`}
            onClick={() => setReader(true)}
          />
          <DownloadHoverButton file={file} onDownload={download} />
        </div>
      )}
      {reader && url && (
        <PdfReader file={file} url={url} onClose={() => setReader(false)} onDownload={download} />
      )}
    </div>
  );
}

/** In-app full PDF reader overlay (browser viewer, toolbar enabled). */
function PdfReader({
  file,
  url,
  onClose,
  onDownload,
}: {
  file: FileDTO;
  url: string;
  onClose: () => void;
  onDownload: () => Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      data-testid="pdf-reader"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75"
      onMouseDown={onClose}
    >
      <div className="absolute top-4 right-5 flex gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
        <button
          data-testid="pdf-reader-open-external"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Open external"
          onClick={() => window.open(url, '_blank')}
        >
          ↗
        </button>
        <button
          data-testid="pdf-reader-download"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Download"
          onClick={() => void onDownload()}
        >
          ⤓
        </button>
        <button
          data-testid="pdf-reader-close"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="h-[90vh] w-[80vw]" onMouseDown={(e) => e.stopPropagation()}>
        <embed src={url} type="application/pdf" className="h-full w-full rounded-lg" />
      </div>
      <span className="mt-2 max-w-[80vw] truncate text-xs text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        {file.name}
      </span>
    </div>
  );
}

function FileChip({ file }: { file: FileDTO }) {
  const download = useDownload(file);
  return (
    <div className="group/att relative mt-1 w-fit">
      <button
        data-testid={`file-${file.name}`}
        className="flex items-center gap-2 rounded-[10px] border border-hairline bg-white py-2 pr-10 pl-3 text-left text-sm hover:border-hairline2"
        onClick={() => void download()}
      >
        <span>📄</span>
        <span>
          <span className="block font-medium">{file.name}</span>
          <span className="block text-xs text-muted">{bytesLabel(file.sizeBytes)}</span>
        </span>
      </button>
      <button
        data-testid={`file-download-${file.name}`}
        className="absolute top-1/2 right-2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink group-hover/att:flex"
        title="Download"
        onClick={() => void download()}
      >
        ⤓
      </button>
    </div>
  );
}

/** In-app image popup (phase 5 item 5): original file, open-external + download icons. */
function ImageLightbox({
  file,
  onClose,
  onDownload,
}: {
  file: FileDTO;
  onClose: () => void;
  onDownload: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
    };
  }, [file.id, onClose]);
  return (
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75"
      onMouseDown={onClose}
    >
      <div className="absolute top-4 right-5 flex gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
        <button
          data-testid="lightbox-open-external"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Open external"
          onClick={() => { if (url) window.open(url, '_blank'); }}
        >
          ↗
        </button>
        <button
          data-testid="lightbox-download"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Download"
          onClick={() => void onDownload()}
        >
          ⤓
        </button>
        <button
          data-testid="lightbox-close"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {url ? (
        <img
          src={url}
          alt={file.name}
          className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain"
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-sm text-white/70">Loading…</span>
      )}
      <span className="mt-3 max-w-[80vw] truncate text-xs text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        {file.name}
      </span>
    </div>
  );
}
