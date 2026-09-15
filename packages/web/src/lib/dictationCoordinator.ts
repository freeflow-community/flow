/** One microphone recognizer may own this browser document at a time. */
export interface DictationCoordinator {
  acquire(owner: symbol, ownerKey: string, cancel: () => void): void;
  release(owner: symbol): void;
  activeOwnerKey(): string | null;
}

export function createDictationCoordinator(): DictationCoordinator {
  let active: { owner: symbol; ownerKey: string; cancel: () => void } | null = null;

  return {
    acquire(owner, ownerKey, cancel) {
      if (active && active.owner !== owner) active.cancel();
      active = { owner, ownerKey, cancel };
    },
    release(owner) {
      if (active?.owner === owner) active = null;
    },
    activeOwnerKey() {
      return active?.ownerKey ?? null;
    },
  };
}

export const dictationCoordinator = createDictationCoordinator();
