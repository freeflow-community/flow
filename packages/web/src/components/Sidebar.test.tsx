import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArtifactDTO, ChannelDTO, WorkspaceMemberDTO } from '@flow/shared';
import {
  ActivityBell,
  ActivitySpinner,
  appEntries,
  channelLabel,
  NavButton,
  nearestScrollDelta,
  nestChannels,
  openChannelFromSidebar,
  splitAgents,
} from './Sidebar';
import type { Selection } from '../state';

// Sub-channel display order (#118). The rule that matters is the fallback: a
// child whose parent isn't in the list must still be rendered, or you lose a
// channel you belong to.
const chan = (id: string, parentId: string | null = null): ChannelDTO => ({
  id,
  workspaceId: 'w1',
  name: id,
  kind: 'standard',
  topic: null,
  isPrivate: false,
  createdBy: 'u1',
  createdAt: '2026-07-29T00:00:00Z',
  archivedAt: null,
  isMember: true,
  lastReadMsgId: null,
  unreadCount: 0,
  unreadNotifications: 0,
  unreadThreadRootIds: [],
  notifyLevel: 1,
  parentId,
});

const shape = (list: ChannelDTO[]) => nestChannels(list).map((r) => `${r.nested ? '  ' : ''}${r.channel.id}`);

describe('nestChannels', () => {
  it('leaves a flat list alone', () => {
    expect(shape([chan('alpha'), chan('beta')])).toEqual(['alpha', 'beta']);
  });

  it('puts a child directly under its parent, indented', () => {
    expect(shape([chan('alpha'), chan('zeta', 'alpha')])).toEqual(['alpha', '  zeta']);
  });

  it('pulls a child up to its parent regardless of input position', () => {
    // The server sorts by name, so a child usually arrives nowhere near its
    // parent — this is the ordinary case, not an edge case.
    expect(shape([chan('alpha'), chan('beta'), chan('gamma', 'alpha')])).toEqual(['alpha', '  gamma', 'beta']);
  });

  it('keeps several children under one parent, in input order', () => {
    expect(shape([chan('alpha'), chan('one', 'alpha'), chan('two', 'alpha')])).toEqual([
      'alpha',
      '  one',
      '  two',
    ]);
  });

  it('renders a child at top level when its parent is not in the list', () => {
    // You can be a member of a child without being in its parent, and the
    // parent may be archived. Either way the channel must not vanish.
    expect(shape([chan('orphan', 'not-here')])).toEqual(['orphan']);
  });

  it('never nests deeper than one level', () => {
    // The server rejects grandchildren. One arriving anyway falls back to top
    // level — the first version of this dropped it from the sidebar entirely.
    expect(shape([chan('alpha'), chan('kid', 'alpha'), chan('grandkid', 'kid')])).toEqual([
      'alpha',
      '  kid',
      'grandkid',
    ]);
  });

  it('returns every channel it was given', () => {
    const list = [chan('a'), chan('b', 'a'), chan('c', 'gone'), chan('d')];
    expect(nestChannels(list)).toHaveLength(list.length);
  });
});

// The "an agent is working here" spinner (#137).
describe('ActivitySpinner', () => {
  it('spins, and holds still for anyone who asked for less motion', () => {
    const html = renderToStaticMarkup(<ActivitySpinner active={false} />);
    expect(html).toContain('animate-spin');
    expect(html).toContain('motion-reduce:animate-none');
  });

  it('is labelled, so it is not a mystery dot', () => {
    expect(renderToStaticMarkup(<ActivitySpinner active={false} />)).toContain('title="an agent is working');
  });

  it('does not shrink the channel name away', () => {
    // It sits after a truncating label — without shrink-0 the ring is what
    // collapses when a long channel name fills the row.
    expect(renderToStaticMarkup(<ActivitySpinner active />)).toContain('shrink-0');
  });
});

// Scrolling the active channel into view (#319). Coordinates are relative to
// the sidebar's scroll viewport; the result is a scrollTop delta.
describe('nearestScrollDelta', () => {
  const ROW = 30;
  const VIEW = 300;

  it('does not move a row that is already fully visible', () => {
    // The sidebar-click case: any scroll here would be a visible jump.
    expect(nearestScrollDelta(0, ROW, VIEW)).toBe(0);
    expect(nearestScrollDelta(120, ROW, VIEW)).toBe(0);
    expect(nearestScrollDelta(VIEW - ROW, ROW, VIEW)).toBe(0);
  });

  it('scrolls down by just enough for a row below the fold', () => {
    // The reported bug: click a notification for a channel low in the list.
    expect(nearestScrollDelta(400, ROW, VIEW)).toBe(130);
    expect(nearestScrollDelta(VIEW, ROW, VIEW)).toBe(ROW);
  });

  it('scrolls up by just enough for a row above the fold', () => {
    expect(nearestScrollDelta(-50, ROW, VIEW)).toBe(-50);
  });

  it('brings a partly-cut row the rest of the way in', () => {
    expect(nearestScrollDelta(VIEW - 10, ROW, VIEW)).toBe(20);
    expect(nearestScrollDelta(-1, ROW, VIEW)).toBe(-1);
  });

  it('aligns a row taller than the viewport to its top', () => {
    // Bottom-aligning it would push the start of the row off-screen.
    expect(nearestScrollDelta(40, 500, VIEW)).toBe(40);
  });
});


// The Agents section (#361): agents are pulled out of Direct messages into
// their own list, DM and all, so nobody is listed twice.
const ME = 'me';
const member = (userId: string, displayName: string, isAgent: boolean): WorkspaceMemberDTO => ({
  userId,
  displayName,
  email: `${userId}@example.com`,
  avatarUrl: null,
  statusEmoji: '',
  statusText: '',
  title: '',
  isAgent,
  isBot: false,
  sponsorId: null,
  role: 'member',
  joinedAt: '2026-08-25T00:00:00Z',
});
const dm = (id: string, memberIds: string[], kind: ChannelDTO['kind'] = 'dm'): ChannelDTO => ({
  ...chan(id),
  name: null,
  kind,
  memberIds,
});

describe('splitAgents', () => {
  const prism = member('a1', 'Prism', true);
  const builder = member('a2', 'builder', true);
  const scott = member('u1', 'Scott', false);

  it('lists an agent that has no DM yet', () => {
    const { agents, rest } = splitAgents([], [prism, scott], ME);
    expect(agents.map((a) => a.member.userId)).toEqual(['a1']);
    expect(agents[0]!.channel).toBeUndefined();
    expect(rest).toEqual([]);
  });

  it('moves an agent DM out of the DM list and onto the agent row', () => {
    const agentDm = dm('d1', [ME, 'a1']);
    const humanDm = dm('d2', [ME, 'u1']);
    const { agents, rest } = splitAgents([agentDm, humanDm], [prism, scott], ME);
    expect(agents[0]!.channel?.id).toBe('d1'); // unread badges ride along with it
    expect(rest.map((c) => c.id)).toEqual(['d2']);
  });

  it('sorts agents alphabetically, ignoring case', () => {
    const { agents } = splitAgents([], [prism, builder], ME);
    expect(agents.map((a) => a.member.displayName)).toEqual(['builder', 'Prism']);
  });

  it('leaves a group DM alone even when an agent is in it', () => {
    // Several people talking is a conversation, not a way to reach the agent.
    const group = dm('g1', [ME, 'a1', 'u1'], 'group_dm');
    const { agents, rest } = splitAgents([group], [prism, scott], ME);
    expect(rest.map((c) => c.id)).toEqual(['g1']);
    expect(agents[0]!.channel).toBeUndefined();
  });

  it('leaves the self-DM under Direct messages', () => {
    const self = dm('s1', [ME]);
    const { rest } = splitAgents([self], [member(ME, 'Me', true), prism], ME);
    expect(rest.map((c) => c.id)).toEqual(['s1']);
  });

  it('finds no agents in a workspace of humans — the section hides itself', () => {
    const { agents, rest } = splitAgents([dm('d2', [ME, 'u1'])], [scott], ME);
    expect(agents).toEqual([]);
    expect(rest).toHaveLength(1);
  });
});

// Activity moved from a channel-list row to a header bell (#385). What the
// tests pin is what the row used to carry: the unread badge and the selected
// state — the parts that would silently vanish in the move.
describe('ActivityBell', () => {
  it('is labelled "Activity", not a bare glyph', () => {
    const html = renderToStaticMarkup(<ActivityBell active={false} unread={0} onOpen={() => {}} />);
    expect(html).toContain('aria-label="Activity"');
    expect(html).toContain('title="Activity"');
  });

  it('badges the unread count, and caps it at 99', () => {
    expect(renderToStaticMarkup(<ActivityBell active={false} unread={3} onOpen={() => {}} />)).toContain('>3<');
    expect(renderToStaticMarkup(<ActivityBell active={false} unread={500} onOpen={() => {}} />)).toContain('>99<');
  });

  it('shows no badge when everything is read', () => {
    expect(renderToStaticMarkup(<ActivityBell active={false} unread={0} onOpen={() => {}} />)).not.toContain('bg-unread');
  });

  it('reads as current while the Activity feed is open', () => {
    const html = renderToStaticMarkup(<ActivityBell active unread={0} onOpen={() => {}} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('bg-white');
  });
});

describe('NavButton', () => {
  it('is labelled Back / Forward rather than a bare chevron', () => {
    const back = renderToStaticMarkup(<NavButton dir="back" enabled onClick={() => {}} />);
    expect(back).toContain('aria-label="Back"');
    expect(back).toContain('title="Back"');
    const fwd = renderToStaticMarkup(<NavButton dir="forward" enabled onClick={() => {}} />);
    expect(fwd).toContain('aria-label="Forward"');
    expect(fwd).toContain('title="Forward"');
  });

  it('points the chevron the way it navigates', () => {
    expect(renderToStaticMarkup(<NavButton dir="back" enabled onClick={() => {}} />)).toContain('15 18 9 12 15 6');
    expect(renderToStaticMarkup(<NavButton dir="forward" enabled onClick={() => {}} />)).toContain('9 18 15 12 9 6');
  });

  it('is dimmed and non-interactive at the end of the history', () => {
    const html = renderToStaticMarkup(<NavButton dir="back" enabled={false} onClick={() => {}} />);
    expect(html).toContain('disabled');
    expect(html).toContain('text-white/25');
  });

  it('is live and hoverable when there is somewhere to go', () => {
    const html = renderToStaticMarkup(<NavButton dir="forward" enabled onClick={() => {}} />);
    expect(html).not.toContain('disabled');
    expect(html).toContain('hover:bg-white/10');
  });
});

// Apps section (#394): the sidebar attaches each app the server returned to its
// host channel, which is where the row's muted secondary label comes from.
const app = (id: string, name: string, channelId: string): ArtifactDTO => ({
  id,
  workspaceId: 'w1',
  channelId,
  kind: 'link',
  fileId: null,
  url: 'https://app.example.com/',
  name,
  ownsFile: false,
  isApp: true,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z',
  file: null,
});

describe('appEntries', () => {
  it('pairs each app with its host channel, keeping the server order', () => {
    const channels = [chan('factory'), chan('general')];
    const entries = appEntries([app('a1', 'Task Board', 'factory'), app('a2', 'Zoo', 'general')], channels);
    expect(entries.map((e) => [e.artifact.name, e.channel.id])).toEqual([
      ['Task Board', 'factory'],
      ['Zoo', 'general'],
    ]);
  });

  it('lists an app from a public channel this user has not joined', () => {
    // The whole point of the section: #factory is public and unjoined, and its
    // Task Board still shows up (clicking it joins).
    const unjoined = { ...chan('factory'), isMember: false };
    const entries = appEntries([app('a1', 'Task Board', 'factory')], [unjoined]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.channel.isMember).toBe(false);
  });

  it('drops an app whose channel is not in the local list', () => {
    // No channel means nothing to join and nowhere to open — a channel-less row
    // would be a dead end, so it is left out rather than rendered.
    expect(appEntries([app('a1', 'Ghost', 'gone')], [chan('general')])).toEqual([]);
  });
});

describe('channelLabel', () => {
  it('names a channel with a hash and a DM by its members', () => {
    expect(channelLabel(chan('factory'), {}, 'me')).toBe('#factory');
    const dm: ChannelDTO = { ...chan('d1'), kind: 'dm', name: null, memberIds: ['me', 'u2'] };
    expect(channelLabel(dm, { u2: 'Prism' }, 'me')).toBe('Prism');
  });
});


// #327: a channel whose unreads are all inside a thread looks unchanged when
// you click it, so clicking opens the thread too.
describe('openChannelFromSidebar', () => {
  const selection = (channelId: string | null) => {
    const calls: string[] = [];
    const sel = {
      channelId,
      selectChannel: (id: string | null) => calls.push(`select:${id}`),
      jumpToMessage: (c: string, m: string, root?: string | null) => calls.push(`jump:${c}:${m}:${root}`),
    } as unknown as Selection;
    return { sel, calls };
  };
  const withUnreadThread = (id: string): ChannelDTO => ({
    ...chan(id),
    unreadNotifications: 2,
    unreadThreadRootIds: ['root1'],
    oldestUnreadThreadReply: { rootId: 'root1', replyId: 'reply1' },
  });

  it('opens the thread holding the oldest unread reply', () => {
    const { sel, calls } = selection('other');
    openChannelFromSidebar(sel, withUnreadThread('alpha'));
    expect(calls).toEqual(['jump:alpha:reply1:root1']);
  });

  it('is a plain channel switch when the oldest unread is top-level', () => {
    const { sel, calls } = selection('other');
    openChannelFromSidebar(sel, { ...chan('alpha'), unreadCount: 3 });
    expect(calls).toEqual(['select:alpha']);
  });

  it('is a plain channel switch with no unreads at all', () => {
    const { sel, calls } = selection('other');
    openChannelFromSidebar(sel, chan('alpha'));
    expect(calls).toEqual(['select:alpha']);
  });

  it('does not yank a thread open in the channel you are already in', () => {
    // Replies landing while you sit in a channel keep it as the auto-open
    // target; re-clicking its row must not throw the panel open under you.
    const { sel, calls } = selection('alpha');
    openChannelFromSidebar(sel, withUnreadThread('alpha'));
    expect(calls).toEqual(['select:alpha']);
  });
});
