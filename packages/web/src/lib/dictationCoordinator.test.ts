import { describe, expect, it } from 'vitest';
import { createDictationCoordinator } from './dictationCoordinator';

describe('dictation coordinator', () => {
  it('cancels the prior owner before granting the microphone to another composer', () => {
    const coordinator = createDictationCoordinator();
    const first = Symbol('main composer');
    const second = Symbol('thread composer');
    let firstCancelled = 0;

    coordinator.acquire(first, 'channel-a|main', () => { firstCancelled += 1; });
    coordinator.acquire(second, 'channel-a|thread-1', () => {});

    expect(firstCancelled).toBe(1);
    expect(coordinator.activeOwnerKey()).toBe('channel-a|thread-1');
  });

  it('does not let an old cleanup release the active composer', () => {
    const coordinator = createDictationCoordinator();
    const first = Symbol('first');
    const second = Symbol('second');
    coordinator.acquire(first, 'first', () => {});
    coordinator.acquire(second, 'second', () => {});

    coordinator.release(first);
    expect(coordinator.activeOwnerKey()).toBe('second');
    coordinator.release(second);
    expect(coordinator.activeOwnerKey()).toBeNull();
  });
});
