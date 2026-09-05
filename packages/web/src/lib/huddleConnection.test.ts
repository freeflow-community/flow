import { describe, expect, it } from 'vitest';
import { huddleConnection, peerConnected, shouldChime, type HuddlePeerState } from './huddleConnection';

const agent = (over: Partial<HuddlePeerState> = {}): HuddlePeerState => ({
  userId: 'u-agent',
  audioLive: true,
  isAgent: true,
  ...over,
});
const person = (over: Partial<HuddlePeerState> = {}): HuddlePeerState => ({
  userId: 'u-ada',
  audioLive: false,
  isAgent: false,
  ...over,
});

describe('huddleConnection', () => {
  it('is idle when nobody else is expected', () => {
    expect(huddleConnection([], [])).toBe('idle');
  });

  it('is connecting while an accepted invite has not arrived in the room', () => {
    expect(huddleConnection([], ['u-agent'])).toBe('connecting');
  });

  it('is connecting for an agent in the room that has published no audio', () => {
    expect(huddleConnection([agent({ audioLive: false })], [])).toBe('connecting');
  });

  it('is connected once the agent publishes audio', () => {
    expect(huddleConnection([agent()], [])).toBe('connected');
  });

  it('counts a person as connected the moment they join, muted or not', () => {
    // Everyone joins muted by decision — waiting for their audio would leave a
    // working human call reading "connecting" until someone unmutes.
    expect(huddleConnection([person()], [])).toBe('connected');
  });

  it('clears back to idle when the peer leaves', () => {
    expect(huddleConnection([agent()], [])).toBe('connected');
    expect(huddleConnection([], [])).toBe('idle');
  });

  it('takes the best peer: one live agent among stragglers is connected', () => {
    expect(huddleConnection([agent({ userId: 'u-a', audioLive: false }), agent({ userId: 'u-b' })], ['u-c'])).toBe(
      'connected',
    );
  });

  it('chimes once a call is up, and only once', () => {
    expect(shouldChime('connected', false)).toBe(true);
    expect(shouldChime('connected', true)).toBe(false);
  });

  it('never chimes for a call that does not connect', () => {
    expect(shouldChime('connecting', false)).toBe(false);
    expect(shouldChime('idle', false)).toBe(false);
  });

  it('peerConnected only demands audio of agents', () => {
    expect(peerConnected(agent({ audioLive: false }))).toBe(false);
    expect(peerConnected(person({ audioLive: false }))).toBe(true);
  });
});
