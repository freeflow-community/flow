import { useEffect, useRef, useState } from 'react';
import type { FileDTO, MessageDTO, WorkspaceMemberDTO } from '@mychat/shared';
import { api, blobUrl } from '../lib/api';
import { bytesLabel, displayTime, renderBody } from '../lib/format';
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
              <p className="text-sm leading-normal break-words whitespace-pre-wrap">
                {renderBody(message.body, names, auth.user.id)}
                {message.editedAt && <span className="ml-1 text-xs text-faint">(edited)</span>}
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
        <AuthImg path={`/v1/files/${file.id}/thumb`} alt={file.name} className="max-h-60 max-w-72 rounded-lg border border-hairline" />
      </button>
    );
  }
  return (
    <button
      data-testid={`file-${file.name}`}
      className="mt-1 flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-3 py-2 text-left text-sm hover:border-hairline2"
      onClick={() => void open()}
    >
      <span>📄</span>
      <span>
        <span className="block font-medium">{file.name}</span>
        <span className="block text-xs text-muted">{bytesLabel(file.sizeBytes)}</span>
      </span>
    </button>
  );
}
