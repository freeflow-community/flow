// Feedback while working (operator ruling 5): typing indicator + a live
// "thinking…" status message that is edited in place per tool call and
// deleted on completion (the real reply posts fresh — clean unread semantics),
// plus the channel's activity spinner (#137) — the same signal for anyone
// looking at the sidebar rather than at the channel.
import type { FlowApi } from './api.js';
import type { FlowSocket } from './gateway.js';
import type { ProgressMode } from './config.js';

const TYPING_INTERVAL_MS = 4000;

// Channel activity indicator (#137). The server expires a set after its TTL, so
// a long turn has to keep saying so; refreshing at a third of the TTL survives
// a couple of missed refreshes (and a socket reconnect) without a flicker.
const INDICATOR_TTL_SECONDS = 90;
const INDICATOR_REFRESH_MS = 30_000;

export class ProgressReporter {
  private typingTimer: NodeJS.Timeout | null = null;
  private indicatorTimer: NodeJS.Timeout | null = null;
  private statusMessageId: string | null = null;
  private inFlight = false;
  private pendingStep: string | null = null;
  private finished = false;
  private indicatorChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: FlowApi,
    private readonly socket: FlowSocket,
    private readonly mode: ProgressMode,
    private readonly channelId: string,
    private readonly threadRootId: string | undefined,
    private readonly log: (msg: string) => void,
  ) {}

  /** The live status row's message id, once it exists — what an Interrupt
   * button reacts to, and how the bridge maps that reaction back to this run. */
  get statusId(): string | null {
    return this.statusMessageId;
  }

  start(): void {
    if (this.mode === 'silent') return;
    this.socket.sendTyping(this.channelId, this.threadRootId);
    this.typingTimer = setInterval(() => this.socket.sendTyping(this.channelId, this.threadRootId), TYPING_INTERVAL_MS);
    this.typingTimer.unref();
    void this.setIndicator('busy');
    this.indicatorTimer = setInterval(() => void this.setIndicator('busy'), INDICATOR_REFRESH_MS);
    this.indicatorTimer.unref();
  }

  /**
   * Errors are swallowed: the spinner is decoration, and a turn must never fail
   * because a channel row didn't light up (an older server 404s here).
   *
   * Serialized through one chain so the final clear can't overtake a set that
   * is still in flight — a turn short enough for that to happen is exactly the
   * one where a stuck spinner would be most obviously wrong.
   */
  private setIndicator(state: 'busy' | 'none'): Promise<void> {
    this.indicatorChain = this.indicatorChain.then(async () => {
      try {
        await this.api.setChannelIndicator(this.channelId, state, INDICATOR_TTL_SECONDS);
      } catch (err) {
        // Never let the chain reject: a rejected link would skip every later
        // set — including the clear that stops the spinner.
        this.log(`channel indicator (${state}) failed: ${(err as Error).message}`);
      }
    });
    return this.indicatorChain;
  }

  /** Latest step wins; edits are serialized (a step landing mid-edit is applied after). */
  onStep(step: string): void {
    if (this.mode !== 'thinking' || this.finished) return;
    this.pendingStep = step;
    if (!this.inFlight) void this.drain();
  }

  private async drain(): Promise<void> {
    this.inFlight = true;
    try {
      while (this.pendingStep !== null && !this.finished) {
        const step = this.pendingStep;
        this.pendingStep = null;
        const body = `🤖 *thinking…* — ${step}`;
        try {
          if (this.statusMessageId === null) {
            const msg = await this.api.sendMessage(this.channelId, body, this.threadRootId);
            this.statusMessageId = msg.id;
          } else {
            await this.api.editMessage(this.statusMessageId, body);
          }
        } catch (err) {
          this.log(`status message failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** Stop typing, clear the channel spinner, and delete the status message (if
   * any). Called on every exit path including failures — the bridge calls it
   * again from a `finally`, and the second call is a no-op. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.typingTimer) clearInterval(this.typingTimer);
    if (this.indicatorTimer) clearInterval(this.indicatorTimer);
    // Only if start() actually turned it on; 'silent' never does.
    if (this.mode !== 'silent') await this.setIndicator('none');
    // wait out an in-flight post/edit so the delete can't race message creation
    while (this.inFlight) await new Promise((r) => setTimeout(r, 25));
    if (this.statusMessageId !== null) {
      // Hard delete: the status message must vanish, not leave a tombstone
      // above the real reply (the reply posts fresh — clean unread semantics).
      await this.api.deleteMessage(this.statusMessageId, { hard: true }).catch((err: Error) => {
        this.log(`status delete failed: ${err.message}`);
      });
      this.statusMessageId = null;
    }
  }
}
