/** Coalesce upload bursts and wait until both sides stop speaking. */
export class SharedReplyScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private closed = false;
  constructor(private readonly options: {
    idle(): boolean;
    reply(): Promise<void>;
    error(): void;
  }) {}
  changed(): void {
    if (this.closed) return;
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 700);
  }
  /** A real spoken turn already consumes the current shared inbox. */
  consumed(): void { this.pending = false; }
  private flush(): void {
    this.timer = undefined;
    if (this.closed || !this.pending) return;
    if (!this.options.idle()) {
      this.timer = setTimeout(() => this.flush(), 300);
      return;
    }
    this.pending = false;
    void this.options.reply().catch(() => { if (!this.closed) this.options.error(); });
  }
  close(): void {
    this.closed = true;
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
