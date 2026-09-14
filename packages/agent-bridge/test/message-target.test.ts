// Where a messaging tool call lands (#320).
//
// Under test (2026-08-23): an agent conversing inside a thread must be able to
// post top-level in a channel — naming a channelId opts out of the ambient
// thread, and an empty threadRootId never silently falls back into it.
import { describe, expect, it } from 'vitest';
import { resolveMessageTarget } from '../src/mcp-server.js';

const CHAN = 'cccccccc-0000-0000-0000-000000000001';
const OTHER = 'cccccccc-0000-0000-0000-000000000002';
const ROOT = 'mmmmmmmm-0000-0000-0000-000000000003';
const OTHER_ROOT = 'mmmmmmmm-0000-0000-0000-000000000004';

const inThread = { channelId: CHAN, threadRootId: ROOT };
const inChannel = { channelId: CHAN, threadRootId: undefined };

describe('resolveMessageTarget', () => {
  it('inherits the ambient thread when the call names no channel', () => {
    expect(resolveMessageTarget({}, inThread)).toEqual({ channelId: CHAN, threadRootId: ROOT });
  });

  it('posts top-level in the current channel when there is no ambient thread', () => {
    expect(resolveMessageTarget({}, inChannel)).toEqual({ channelId: CHAN, threadRootId: undefined });
  });

  it('posts top-level when the call names another channel from inside a thread', () => {
    expect(resolveMessageTarget({ channelId: OTHER }, inThread)).toEqual({
      channelId: OTHER,
      threadRootId: undefined,
    });
  });

  it('posts top-level when the named channel IS the thread’s own channel (the #320 repro)', () => {
    expect(resolveMessageTarget({ channelId: CHAN }, inThread)).toEqual({
      channelId: CHAN,
      threadRootId: undefined,
    });
  });

  it('treats an empty threadRootId as an explicit top-level, not a fallback', () => {
    expect(resolveMessageTarget({ threadRootId: '' }, inThread)).toEqual({
      channelId: CHAN,
      threadRootId: undefined,
    });
    expect(resolveMessageTarget({ threadRootId: '   ' }, inThread)).toEqual({
      channelId: CHAN,
      threadRootId: undefined,
    });
  });

  it('still replies into an explicitly named thread', () => {
    expect(resolveMessageTarget({ threadRootId: OTHER_ROOT }, inThread)).toEqual({
      channelId: CHAN,
      threadRootId: OTHER_ROOT,
    });
    expect(resolveMessageTarget({ channelId: OTHER, threadRootId: OTHER_ROOT }, inThread)).toEqual({
      channelId: OTHER,
      threadRootId: OTHER_ROOT,
    });
  });

  it('falls back to the ambient channel for a blank or non-string channelId', () => {
    expect(resolveMessageTarget({ channelId: '  ' }, inThread)).toEqual({ channelId: CHAN, threadRootId: ROOT });
    expect(resolveMessageTarget({ channelId: 42 }, inThread)).toEqual({ channelId: CHAN, threadRootId: ROOT });
  });
});
