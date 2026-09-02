import { describe, expect, it } from 'vitest';
import type { HuddleInviteDTO } from '@flow/shared';
import { ringEffect } from './huddleRing';

const ME = 'u-me';
const CALLER = 'u-caller';

function invite(over: Partial<HuddleInviteDTO> = {}): HuddleInviteDTO {
  return {
    id: 'i1',
    workspaceId: 'w1',
    channelId: 'c1',
    startedBy: CALLER,
    status: 'ringing',
    startedAt: '2026-09-02T00:00:00.000Z',
    answeredAt: null,
    endedAt: null,
    targets: [{ userId: ME, status: 'ringing', respondedAt: null }],
    ...over,
  };
}

describe('ringEffect', () => {
  it('rings a target whose row is still ringing', () => {
    expect(ringEffect(invite(), { selfId: ME, mySessionId: 's1' })).toEqual({ kind: 'ring', invite: invite() });
  });

  it('ignores an invite this user is not a target of', () => {
    expect(ringEffect(invite(), { selfId: 'u-other', mySessionId: 's1' })).toEqual({ kind: 'ignore' });
  });

  it('dismisses on the device that answered', () => {
    const accepted = invite({ status: 'active', targets: [{ userId: ME, status: 'accepted', respondedAt: 'x' }] });
    expect(ringEffect(accepted, { selfId: ME, mySessionId: 's1', answeredBySessionId: 's1' })).toEqual({
      kind: 'dismiss',
    });
  });

  it('explains itself on the devices that did not answer', () => {
    const accepted = invite({ status: 'active', targets: [{ userId: ME, status: 'accepted', respondedAt: 'x' }] });
    expect(ringEffect(accepted, { selfId: ME, mySessionId: 's2', answeredBySessionId: 's1' })).toEqual({
      kind: 'answered-elsewhere',
    });
  });

  it('dismisses without explanation when the ring simply ended', () => {
    const missed = invite({ status: 'missed', targets: [{ userId: ME, status: 'missed', respondedAt: 'x' }] });
    expect(ringEffect(missed, { selfId: ME, mySessionId: 's1' })).toEqual({ kind: 'dismiss' });
  });

  it('keeps a group-DM card up while this user is still ringing, though another accepted', () => {
    const active = invite({
      status: 'active',
      targets: [
        { userId: 'u-them', status: 'accepted', respondedAt: 'x' },
        { userId: ME, status: 'ringing', respondedAt: null },
      ],
    });
    // Late join is allowed while the call is active, so the card must survive
    // someone else answering first.
    expect(ringEffect(active, { selfId: ME, mySessionId: 's1' })).toEqual({ kind: 'ring', invite: active });
  });

  it('tracks the caller’s own ring and who could not be reached', () => {
    expect(ringEffect(invite(), { selfId: CALLER, mySessionId: 's1', unavailable: ['Bob'] })).toEqual({
      kind: 'outgoing',
      invite: invite(),
      unavailable: ['Bob'],
    });
    const missed = invite({ status: 'missed' });
    expect(ringEffect(missed, { selfId: CALLER, mySessionId: 's1' })).toEqual({
      kind: 'outgoing',
      invite: null,
      unavailable: [],
    });
  });
});
