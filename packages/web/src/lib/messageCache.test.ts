import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { MessageDTO, MessagePage } from '@flow/shared';
import {
  applyMessageEvent,
  applyTopLevel,
  pendingId,
  removePendingMessage,
  type MessagesData,
  type ThreadData,
} from './messageCache';

let seq = 0;
function msg(over: Partial<MessageDTO> = {}): MessageDTO {
  seq += 1;
  return {
    id: over.id ?? `01948-${String(seq).padStart(4, '0')}`,
    channelId: 'chan-1',
    userId: 'user-a',
    threadRootId: null,
    clientMsgId: over.clientMsgId ?? `cmid-${seq}-${Math.random().toString(36).slice(2)}`,
    body: 'hello',
    createdAt: '2026-07-20T00:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    replyCount: 0,
    lastReplyAt: null,
    replyParticipantUserIds: [],
    reactions: [],
    unfurls: [],
    files: [],
    ...over,
  };
}

const page = (messages: MessageDTO[], hasMore = false): MessagePage => ({ messages, hasMore });
const data = (...pages: MessagePage[]): MessagesData => ({
  pages,
  pageParams: pages.map((_, i) => (i === 0 ? '' : `cursor-${i}`)),
});

const channelCache = (qc: QueryClient): MessageDTO[] =>
  (qc.getQueryData<MessagesData>(['messages', 'chan-1'])?.pages ?? []).flatMap((p) => p.messages);

describe('applyTopLevel', () => {
  it('prepends a new message to the newest page', () => {
    const older = msg();
    const incoming = msg();
    const r = applyTopLevel(data(page([older], true), page([msg()])), incoming, true);
    expect(r.inserted).toBe(true);
    expect(r.data.pages[0]!.messages.map((m) => m.id)).toEqual([incoming.id, older.id]);
    expect(r.data.pages[0]!.hasMore).toBe(true); // page metadata untouched
  });

  it('reconciles a pending row by clientMsgId in place', () => {
    const real = msg({ clientMsgId: 'cm-recon' });
    const optimistic = { ...real, id: pendingId('cm-recon'), pending: true };
    const newer = msg();
    const r = applyTopLevel(data(page([newer, optimistic])), real, true);
    expect(r.inserted).toBe(false);
    expect(r.data.pages[0]!.messages.map((m) => m.id)).toEqual([newer.id, real.id]);
  });

  it('does not materialize unknown rows when insert=false (edit of unloaded message)', () => {
    const existing = msg();
    const r = applyTopLevel(data(page([existing])), msg(), false);
    expect(r.data.pages[0]!.messages).toHaveLength(1);
  });
});

describe('applyMessageEvent', () => {
  it('optimistic insert then POST response then WS echo yields exactly one row', () => {
    const qc = new QueryClient();
    qc.setQueryData<MessagesData>(['messages', 'chan-1'], data(page([msg()])));
    const real = msg({ clientMsgId: 'cm-once' });
    const optimistic = { ...real, id: pendingId('cm-once'), pending: true };
    applyMessageEvent(qc, optimistic, true);
    applyMessageEvent(qc, real, true); // POST response
    applyMessageEvent(qc, real, true); // WS echo
    const rows = channelCache(qc).filter((m) => m.clientMsgId === 'cm-once');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(real.id);
  });

  it('leaves never-loaded channels untouched', () => {
    const qc = new QueryClient();
    applyMessageEvent(qc, msg({ channelId: 'chan-unloaded' }), true);
    expect(qc.getQueryData(['messages', 'chan-unloaded'])).toBeUndefined();
  });

  it('a thread reply appends to the thread and bumps the root rollup exactly once', () => {
    const qc = new QueryClient();
    const root = msg({ id: 'root-1' });
    qc.setQueryData<MessagesData>(['messages', 'chan-1'], data(page([root])));
    qc.setQueryData<ThreadData>(['thread', 'root-1'], { root, messages: [], hasMore: false });

    const real = msg({ threadRootId: 'root-1', clientMsgId: 'cm-reply', userId: 'user-b' });
    const optimistic = { ...real, id: pendingId('cm-reply'), pending: true };
    applyMessageEvent(qc, optimistic, true);
    applyMessageEvent(qc, real, true); // response
    applyMessageEvent(qc, real, true); // echo

    const thread = qc.getQueryData<ThreadData>(['thread', 'root-1'])!;
    expect(thread.messages.map((m) => m.id)).toEqual([real.id]);
    expect(thread.root.replyCount).toBe(1);
    const chanRoot = channelCache(qc).find((m) => m.id === 'root-1')!;
    expect(chanRoot.replyCount).toBe(1);
    expect(chanRoot.replyParticipantUserIds).toEqual(['user-b']);
    expect(chanRoot.lastReplyAt).toBe(real.createdAt);
  });

  it('message.updated replaces in place without inserting', () => {
    const qc = new QueryClient();
    const original = msg();
    qc.setQueryData<MessagesData>(['messages', 'chan-1'], data(page([original])));
    applyMessageEvent(qc, { ...original, body: 'edited', editedAt: '2026-07-20T01:00:00.000Z' }, false);
    const rows = channelCache(qc);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('edited');
  });
});

describe('removePendingMessage', () => {
  it('drops a failed top-level send', () => {
    const qc = new QueryClient();
    qc.setQueryData<MessagesData>(['messages', 'chan-1'], data(page([msg()])));
    const optimistic = msg({ id: pendingId('cm-fail'), clientMsgId: 'cm-fail' });
    applyMessageEvent(qc, optimistic, true);
    removePendingMessage(qc, 'chan-1', 'cm-fail');
    expect(channelCache(qc).some((m) => m.id === pendingId('cm-fail'))).toBe(false);
  });

  it('a failed reply un-bumps the root and a retry can bump again', () => {
    const qc = new QueryClient();
    const root = msg({ id: 'root-2' });
    qc.setQueryData<MessagesData>(['messages', 'chan-1'], data(page([root])));
    qc.setQueryData<ThreadData>(['thread', 'root-2'], { root, messages: [], hasMore: false });

    const optimistic = msg({
      id: pendingId('cm-refail'),
      clientMsgId: 'cm-refail',
      threadRootId: 'root-2',
    });
    applyMessageEvent(qc, optimistic, true);
    removePendingMessage(qc, 'chan-1', 'cm-refail', 'root-2');
    expect(qc.getQueryData<ThreadData>(['thread', 'root-2'])!.root.replyCount).toBe(0);
    expect(channelCache(qc).find((m) => m.id === 'root-2')!.replyCount).toBe(0);

    // retry with the same clientMsgId bumps again (dedupe key was freed)
    applyMessageEvent(qc, optimistic, true);
    expect(channelCache(qc).find((m) => m.id === 'root-2')!.replyCount).toBe(1);
  });
});
