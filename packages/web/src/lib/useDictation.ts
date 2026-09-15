import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  DictationController,
  bindDictationPageEvents,
  type DictationCallbacks,
  type DictationCancelReason,
  type DictationState,
} from './dictationController';

export type { DictationEndReason, DictationState } from './dictationController';

export interface DictationControls {
  supported: boolean;
  state: DictationState;
  isActive: boolean;
  interimText: string;
  error: string | null;
  start(): void;
  stop(): void;
  cancel(reason?: DictationCancelReason): void;
  clearError(): void;
}

/**
 * Browser-managed dictation for one composer. Lifecycle rules live in
 * `DictationController`; this hook binds it to React: the latest callbacks,
 * page events, owner changes, and unmount.
 */
export function useDictation(options: DictationCallbacks): DictationControls {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [controller] = useState(() => new DictationController(() => callbacks.current));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => bindDictationPageEvents(controller), [controller]);

  // A new channel, thread, edit target, or backend must never receive late
  // results from the previous one. Layout effect: cancel in the same commit,
  // before a queued recognizer event can run against the new owner.
  const ownerKey = useRef(options.ownerKey);
  useLayoutEffect(() => {
    if (ownerKey.current === options.ownerKey) return;
    ownerKey.current = options.ownerKey;
    controller.cancel('owner-change');
  }, [controller, options.ownerKey]);

  useEffect(() => () => controller.cancel('unmount'), [controller]);

  return {
    ...snapshot,
    isActive: snapshot.state === 'starting' || snapshot.state === 'listening' || snapshot.state === 'stopping',
    start: controller.start,
    stop: controller.stop,
    cancel: controller.cancel,
    clearError: controller.clearError,
  };
}
