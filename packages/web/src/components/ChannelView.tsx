import { useEffect, useMemo, useRef } from 'react';
import { useAuth, useLive, useSelection } from '../state';
import { useChannels, useMarkRead, useMessages, useNameMap, flattenMessages } from '../hooks';
import { dmTitle } from './Sidebar';
import MessageList from './MessageList';
import Composer from './Composer';

export default function ChannelView({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const channels = useChannels(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const messagesQ = useMessages(channelId);
  const markRead = useMarkRead();
  const lastReadRef = useRef<string | null>(null);

  const channel = (channels.data ?? []).find((c) => c.id === channelId);
  const messages = useMemo(() => flattenMessages(messagesQ.data?.pages), [messagesQ.data]);

  // mark read whenever the newest visible message changes
  const newestId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  useEffect(() => {
    if (newestId && newestId !== lastReadRef.current) {
      lastReadRef.current = newestId;
      markRead.mutate({ channelId, lastReadMsgId: newestId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, channelId]);

  const title = channel
    ? channel.kind === 'standard'
      ? `#${channel.name}`
      : dmTitle(channel, names, auth.user.id)
    : '';

  const typingNames = Object.entries(live.typing[channelId] ?? {})
    .filter(([uid, ts]) => Date.now() - ts < 5000 && uid !== auth.user.id)
    .map(([uid]) => names[uid] ?? 'Someone');

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5">
        <h2 data-testid="channel-header" className="font-bold">
          {title}
        </h2>
        {channel?.topic && <span className="truncate text-sm text-gray-500">{channel.topic}</span>}
        {channel?.archivedAt && <span className="text-xs text-orange-600">archived</span>}
      </header>

      <MessageList
        messages={messages}
        names={names}
        hasMore={messagesQ.hasNextPage ?? false}
        onLoadOlder={() => void messagesQ.fetchNextPage()}
        showThreadAffordances
      />

      <div className="h-5 px-4 text-xs text-gray-500" data-testid="typing-indicator-slot">
        {typingNames.length === 1 && <span data-testid="typing-indicator">{typingNames[0]} is typing…</span>}
        {typingNames.length > 1 && <span data-testid="typing-indicator">Several people are typing…</span>}
      </div>

      {channel?.archivedAt ? (
        <p className="px-4 pb-4 text-sm text-gray-500">This channel is archived and read-only.</p>
      ) : (
        <Composer channelId={channelId} placeholder={`Message ${title}`} />
      )}
    </section>
  );
}
