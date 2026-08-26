import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChannelDTO, WorkspaceMemberDTO } from '@flow/shared';
import { ActivitySpinner, nearestScrollDelta, nestChannels, splitAgents } from './Sidebar';

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
