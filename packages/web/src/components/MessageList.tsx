import { useEffect, useRef, useState } from 'react';
import type { FileDTO, MessageDTO } from '@mychat/shared';
import { api, blobUrl } from '../lib/api';
import { bytesLabel, displayTime, renderBody } from '../lib/format';
import { useAuth, useSelection } from '../state';
import { useToggleReaction } from '../hooks';
import EmojiPicker from './EmojiPicker';

export default function MessageList({
  messages,
  names,
  hasMore,
  onLoadOlder,
  showThreadAffordances,
}: {
  messages: MessageDTO[];
  names: Record<string, string>;
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
          <button className="text-sm text-blue-600 hover:underline" onClick={onLoadOlder}>
            Load earlier messages
          </button>
        </div>
      )}
      {messages.map((m, i) => (
        <MessageRow
          key={m.id}
          message={m}
          names={names}
          showHeader={showsHeader(messages, i)}
          showThreadAffordances={showThreadAffordances}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function showsHeader(messages: MessageDTO[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1]!;
  const cur = messages[index]!;
  if (prev.userId !== cur.userId) return true;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > 300_000;
}

function MessageRow({
  message,
  names,
  showHeader,
  showThreadAffordances,
}: {
  message: MessageDTO;
  names: Record<string, string>;
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

  const saveEdit = async () => {
    const body = editText.trim();
    if (body) await api('PATCH', `/v1/messages/${message.id}`, { body });
    setEditing(false);
  };

  return (
    <div
      data-testid={`message-${message.id}`}
      className="group relative px-4 py-0.5 hover:bg-gray-50"
    >
      {showHeader && (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-bold">{sender}</span>
          <span className="text-xs text-gray-400">{displayTime(message.createdAt)}</span>
        </div>
      )}

      {message.deletedAt ? (
        <p className="text-sm text-gray-400 italic">This message was deleted</p>
      ) : editing ? (
        <div className="flex gap-2 py-1">
          <input
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
          <button className="text-sm text-blue-600" onClick={() => void saveEdit()}>Save</button>
          <button className="text-sm text-gray-500" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <>
          {message.body.trim() && (
            <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
              {renderBody(message.body, names, auth.user.id)}
              {message.editedAt && <span className="ml-1 text-xs text-gray-400">(edited)</span>}
            </p>
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
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      mineR ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                    onClick={() => toggle.mutate({ message, emoji: r.emoji, mine: mineR })}
                  >
                    {r.emoji} {r.count}
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
          className="mt-0.5 text-xs text-blue-600 hover:underline"
          onClick={() => sel.openThread(message.id)}
        >
          {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {!message.deletedAt && !editing && (
        <div className="absolute top-0 right-4 hidden gap-1 rounded border border-gray-200 bg-white px-1 shadow-sm group-hover:flex">
          <button
            data-testid={`add-reaction-${message.id}`}
            className="px-1 text-sm hover:bg-gray-100"
            title="Add reaction"
            onClick={() => setShowPicker(true)}
          >
            🙂
          </button>
          {showThreadAffordances && (
            <button
              className="px-1 text-sm hover:bg-gray-100"
              title="Reply in thread"
              onClick={() => sel.openThread(message.threadRootId ?? message.id)}
            >
              💬
            </button>
          )}
          {mine && (
            <>
              <button
                className="px-1 text-sm hover:bg-gray-100"
                title="Edit"
                onClick={() => { setEditText(message.body); setEditing(true); }}
              >
                ✏️
              </button>
              <button
                className="px-1 text-sm hover:bg-gray-100"
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
        <div className="absolute top-6 right-4 z-30">
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

function Attachment({ file }: { file: FileDTO }) {
  const open = async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };

  if (file.hasThumb) {
    return (
      <button data-testid={`file-${file.name}`} className="mt-1 block" onClick={() => void open()} title={file.name}>
        <AuthImg path={`/v1/files/${file.id}/thumb`} alt={file.name} className="max-h-60 max-w-72 rounded-lg border border-gray-200" />
      </button>
    );
  }
  return (
    <button
      data-testid={`file-${file.name}`}
      className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm hover:border-gray-300"
      onClick={() => void open()}
    >
      <span>📄</span>
      <span>
        <span className="block font-medium">{file.name}</span>
        <span className="block text-xs text-gray-500">{bytesLabel(file.sizeBytes)}</span>
      </span>
    </button>
  );
}

export function AuthImg({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blobUrl(path).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [path]);
  if (!url) return <span className={`inline-block h-24 w-32 animate-pulse rounded-lg bg-gray-100 ${className ?? ''}`} />;
  return <img src={url} alt={alt} className={className} />;
}
