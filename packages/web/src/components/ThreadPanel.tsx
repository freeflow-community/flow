import { useMemo } from 'react';
import { useSelection } from '../state';
import { useNameMap, useThread } from '../hooks';
import MessageList from './MessageList';
import Composer from './Composer';

export default function ThreadPanel({ rootId }: { rootId: string }) {
  const sel = useSelection();
  const thread = useThread(rootId);
  const names = useNameMap(sel.workspaceId);

  const messages = useMemo(() => {
    if (!thread.data) return [];
    return [thread.data.root, ...thread.data.messages];
  }, [thread.data]);

  const channelId = thread.data?.root.channelId;

  return (
    <aside
      data-testid="thread-panel"
      className="flex w-96 shrink-0 flex-col border-l border-hairline"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="font-bold">Thread</h3>
        <button
          data-testid="thread-close"
          className="rounded px-2 text-faint hover:bg-daypill hover:text-ink"
          onClick={() => sel.openThread(null)}
        >
          ✕
        </button>
      </header>
      <MessageList
        messages={messages}
        names={names}
        hasMore={false}
        onLoadOlder={() => {}}
        showThreadAffordances={false}
      />
      {channelId && (
        <Composer channelId={channelId} threadRootId={rootId} placeholder="Reply in thread" />
      )}
    </aside>
  );
}
