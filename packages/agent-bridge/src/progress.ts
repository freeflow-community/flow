// Feedback while working (operator ruling 5): typing indicator + a live
// "thinking…" status message that is edited in place per tool call and
// deleted on completion (the real reply posts fresh — clean unread semantics).
import type { FlowApi } from './api.js';
import type { FlowSocket } from './gateway.js';
import type { ProgressMode } from './config.js';

const TYPING_INTERVAL_MS = 4000;

export class ProgressReporter {
  private typingTimer: NodeJS.Timeout | null = null;
  private statusMessageId: string | null = null;
  private inFlight = false;
  private pendingStep: string | null = null;
  private finished = false;

  constructor(
    private readonly api: FlowApi,
    private readonly socket: FlowSocket,
    private readonly mode: ProgressMode,
    private readonly channelId: string,
    private readonly threadRootId: string | undefined,
    private readonly log: (msg: string) => void,
  ) {}

  start(): void {
    if (this.mode === 'silent') return;
    this.socket.sendTyping(this.channelId);
    this.typingTimer = setInterval(() => this.socket.sendTyping(this.channelId), TYPING_INTERVAL_MS);
    this.typingTimer.unref();
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

  /** Stop typing and delete the status message (if any). */
  async finish(): Promise<void> {
    this.finished = true;
    if (this.typingTimer) clearInterval(this.typingTimer);
    // wait out an in-flight post/edit so the delete can't race message creation
    while (this.inFlight) await new Promise((r) => setTimeout(r, 25));
    if (this.statusMessageId !== null) {
      await this.api.deleteMessage(this.statusMessageId).catch((err: Error) => {
        this.log(`status delete failed: ${err.message}`);
      });
      this.statusMessageId = null;
    }
  }
}
