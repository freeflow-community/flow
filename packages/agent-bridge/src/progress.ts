// Feedback while working (operator ruling 5): typing indicator + a live
// "thinking…" status message that is edited in place per tool call and
// deleted on completion (the real reply posts fresh — clean unread semantics),
// plus the channel's activity spinner (#137) — the same signal for anyone
// looking at the sidebar rather than at the channel.
//
// And, since #162, the agent's own running commentary: assistant text blocks
// are relayed into the conversation as they arrive instead of being discarded,
// so a long turn reads as progress rather than silence then a wall of text.
import type { FlowApi } from './api.js';
import type { FlowSocket } from './gateway.js';
import type { ProgressMode } from './config.js';

const TYPING_INTERVAL_MS = 4000;

/**
 * Relayed narration (#162) is written by *editing one message*, because an edit
 * is free where a post is not: the server counts unread as "messages newer than
 * your read cursor" and only creates notification rows in sendMessage, so
 * `message.updated` can neither badge a channel nor push a DM. A message per
 * chunk would notify once per sentence.
 *
 * The message is sealed and a fresh one started once it passes this many
 * characters — a forty-minute turn should leave a few readable messages, not
 * one unbounded wall that clients have to truncate.
 */
const NARRATION_MAX_CHARS = 2000;

/**
 * Floor between narration writes. Text blocks can land in bursts (a plan, then
 * its first step, a second apart); coalescing them into one edit costs a beat
 * of latency on a message nobody is waiting on. finish() flushes immediately,
 * so this never delays the end of a turn.
 */
const NARRATION_MIN_INTERVAL_MS = 1500;

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
  /** Text blocks waiting to be written into the narration message. */
  private pendingText: string[] = [];
  /** The narration message being grown, and the blocks currently in it. */
  private narrationMessageId: string | null = null;
  private narrationChunks: string[] = [];
  private lastNarrationWrite = 0;
  private waitTimer: NodeJS.Timeout | null = null;
  private waitResolve: (() => void) | null = null;

  constructor(
    private readonly api: FlowApi,
    private readonly socket: FlowSocket,
    private readonly mode: ProgressMode,
    /** Relay the agent's interim text (#162). Off → the pre-#162 quiet turn. */
    private readonly relayText: boolean,
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

  /**
   * A text block the agent produced mid-turn (#162). Queued, not written: the
   * drain loop coalesces a burst into one edit.
   */
  onText(text: string): void {
    if (!this.relayText || this.mode !== 'thinking' || this.finished) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.pendingText.push(trimmed);
    if (!this.inFlight) void this.drain();
  }

  private async drain(): Promise<void> {
    this.inFlight = true;
    try {
      while (!this.finished && (this.pendingStep !== null || this.pendingText.length > 0)) {
        // The status row goes first and unthrottled — it is one small edit and
        // it is the thing someone watching a stuck turn is staring at.
        if (this.pendingStep !== null) {
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
          continue;
        }
        const wait = NARRATION_MIN_INTERVAL_MS - (Date.now() - this.lastNarrationWrite);
        // Re-loop rather than falling through: a step may have arrived while we
        // waited, and it shouldn't sit behind the narration write.
        if (wait > 0) {
          await this.wait(wait);
          continue;
        }
        await this.writeNarration();
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** Sleep, but interruptibly — finish() must not have to wait out a throttle. */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waitResolve = resolve;
      this.waitTimer = setTimeout(() => this.wake(), ms);
      this.waitTimer.unref();
    });
  }

  private wake(): void {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
    const resolve = this.waitResolve;
    this.waitResolve = null;
    resolve?.();
  }

  /**
   * Move as many queued blocks as fit into the current narration message and
   * write it. A block that would overflow the cap seals the message where it
   * is — everything in it is already on the server — and opens a new one.
   */
  private async writeNarration(): Promise<void> {
    while (this.pendingText.length > 0) {
      const chunk = this.pendingText[0]!;
      if (this.narrationChunks.length > 0 && this.narrationBody().length + chunk.length > NARRATION_MAX_CHARS) {
        // Nothing to seal yet — write what we have, and the next pass rolls over.
        if (this.narrationMessageId === null) break;
        this.narrationMessageId = null;
        this.narrationChunks = [];
      }
      this.narrationChunks.push(this.pendingText.shift()!);
    }
    this.lastNarrationWrite = Date.now();
    await this.putNarration();
  }

  private narrationBody(): string {
    return this.narrationChunks.join('\n\n');
  }

  /** Create the narration message, or edit it to its current contents. */
  private async putNarration(): Promise<void> {
    const body = this.narrationBody();
    try {
      if (this.narrationMessageId === null) {
        const msg = await this.api.sendMessage(this.channelId, body, this.threadRootId);
        this.narrationMessageId = msg.id;
      } else {
        await this.api.editMessage(this.narrationMessageId, body);
      }
    } catch (err) {
      // Narration is commentary: a failed write must never fail the turn. The
      // chunks stay queued in the message, so the next write catches up.
      this.log(`relayed text failed: ${(err as Error).message}`);
    }
  }

  /**
   * Flush what the throttle was still holding, then reconcile with the reply
   * about to be posted. Claude's terminal `result` text *is* the last assistant
   * text block, so the tail we relayed is usually the reply verbatim — drop it
   * from the narration and let it post fresh (that post is what notifies you
   * the turn is over). A narration left with nothing in it is deleted, so a
   * short turn looks exactly as it did before #162.
   */
  private async settleNarration(finalText: string | undefined): Promise<void> {
    const final = finalText?.trim();
    // Usually the repeat is still queued — then it is simply never written.
    if (final && this.pendingText[this.pendingText.length - 1] === final) this.pendingText.pop();
    while (this.pendingText.length > 0) await this.writeNarration();
    if (this.narrationMessageId === null) return;
    if (!final || this.narrationChunks[this.narrationChunks.length - 1] !== final) return;
    this.narrationChunks.pop();
    if (this.narrationChunks.length > 0) return void (await this.putNarration());
    await this.api.deleteMessage(this.narrationMessageId, { hard: true }).catch((err: Error) => {
      this.log(`relayed text delete failed: ${err.message}`);
    });
    this.narrationMessageId = null;
  }

  /** Stop typing, clear the channel spinner, settle the relayed narration and
   * delete the status message (if any). Called on every exit path including
   * failures — the bridge calls it again from a `finally`, and the second call
   * is a no-op. `finalText` is what the bridge is about to post as the reply,
   * so the narration can avoid ending on the same words. */
  async finish(finalText?: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.typingTimer) clearInterval(this.typingTimer);
    if (this.indicatorTimer) clearInterval(this.indicatorTimer);
    // Only if start() actually turned it on; 'silent' never does.
    if (this.mode !== 'silent') await this.setIndicator('none');
    // wait out an in-flight post/edit so the delete can't race message creation
    this.wake(); // don't sit out a narration throttle we're about to flush anyway
    while (this.inFlight) await new Promise((r) => setTimeout(r, 25));
    await this.settleNarration(finalText);
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
