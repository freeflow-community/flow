// The "thinking…" progress indicator must be scoped to the composer the agent
// is answering in. Regression (2026-07-23): when replying inside a thread the
// typing frames dropped threadRootId, so clients rendered "CloudBot thinking…"
// above the main channel composer instead of the thread reply composer.
import { describe, expect, it, vi } from 'vitest';
import { ProgressReporter } from '../src/progress.js';
import type { FlowApi } from '../src/api.js';
import type { FlowSocket } from '../src/gateway.js';

function makeReporter(threadRootId: string | undefined) {
  const sendTyping = vi.fn();
  const socket = { sendTyping } as unknown as FlowSocket;
  const api = {} as unknown as FlowApi;
  const reporter = new ProgressReporter(api, socket, 'thinking', 'chan-1', threadRootId, () => {});
  return { reporter, sendTyping };
}

describe('ProgressReporter typing scope', () => {
  it('carries threadRootId when answering in a thread', () => {
    const { reporter, sendTyping } = makeReporter('root-42');
    reporter.start();
    expect(sendTyping).toHaveBeenCalledWith('chan-1', 'root-42');
    void reporter.finish();
  });

  it('omits threadRootId for a top-level channel reply', () => {
    const { reporter, sendTyping } = makeReporter(undefined);
    reporter.start();
    expect(sendTyping).toHaveBeenCalledWith('chan-1', undefined);
    void reporter.finish();
  });
});
