import { describe, expect, it } from 'vitest';
import {
  BackendError, CAPABILITY_NAMES, allSupported, assertSlackTs, canUse, capabilitiesFrom, dedupeMessages, isSlackTs,
  limited, slackIdentityString, slackMessageKey, slackMessageKeyString, slackTsToIso, supported, unavailable,
} from '@flow/shared';

describe('WorkspaceBackend contract helpers', () => {
  it('capability tri-state carries a reason unless supported', () => {
    expect(supported()).toEqual({ state: 'supported' });
    expect(limited('Slack allows one history page per minute.').reason).toMatch(/one history page/);
    expect(unavailable('Not granted.').state).toBe('unavailable');
    const caps = capabilitiesFrom(unavailable('Slack workspaces do not have this.'), { send: supported(), history: limited('1/min') });
    expect(canUse(caps, 'send')).toBe(true);
    expect(canUse(caps, 'history')).toBe(true);
    expect(canUse(caps, 'artifacts')).toBe(false);
    expect(caps.artifacts.reason).toMatch(/Slack workspaces/);
    expect(Object.keys(allSupported()).sort()).toEqual([...CAPABILITY_NAMES].sort());
  });

  it('keeps a Slack ts as an exact string and never through a number', () => {
    expect(isSlackTs('1789171841.148649')).toBe(true);
    expect(isSlackTs('1789171841.14864')).toBe(false);
    expect(isSlackTs(1789171841.148649)).toBe(false);
    expect(isSlackTs('1789171841')).toBe(false);
    expect(() => assertSlackTs(1789171841.148649 as unknown as string)).toThrow(BackendError);
    expect(() => assertSlackTs('1789171841.148649')).not.toThrow();
    // A float would have lost the trailing digits; the key keeps them.
    const key = slackMessageKey('conn-1', 'T1', 'C1', '1789171841.100000');
    expect(slackMessageKeyString(key)).toBe('slack:conn-1:T1:C1:1789171841.100000');
    expect(slackTsToIso('1789171841.148649')).toBe(new Date(1789171841 * 1000 + 148).toISOString());
  });

  it('two teams sharing a ts never collide, and identity serializes the tuple', () => {
    const a = slackMessageKeyString(slackMessageKey('conn-1', 'T1', 'C1', '1700000000.000001'));
    const b = slackMessageKeyString(slackMessageKey('conn-2', 'T2', 'C1', '1700000000.000001'));
    expect(a).not.toBe(b);
    expect(slackIdentityString({ environment: 'slack', enterpriseId: null, teamId: 'T1', userId: 'U1' })).toBe('["slack",null,"T1","U1"]');
    expect(slackIdentityString({ environment: 'slack', enterpriseId: 'E1', teamId: 'T1', userId: 'U1' })).toBe('["slack","E1","T1","U1"]');
  });

  it('dedupes messages that arrive from both a page and an event, keeping order', () => {
    const rows = [{ id: '1.000001' }, { id: '1.000002' }, { id: '1.000001' }, { id: '1.000003' }];
    expect(dedupeMessages(rows).map(r => r.id)).toEqual(['1.000001', '1.000002', '1.000003']);
  });

  it('BackendError carries a retry hint for rate limits', () => {
    const err = new BackendError('rate_limited', 'Slack asked us to wait', { retryAfterMs: 60_000, providerCode: 'ratelimited' });
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(60_000);
    expect(err.providerCode).toBe('ratelimited');
    expect(err).toBeInstanceOf(Error);
  });
});
