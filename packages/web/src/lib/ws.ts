// Thin WS client mirroring the macOS SocketClient (phase1.md §4): auth frame,
// ping→pong, reconnect with backoff. Online-only client: every reconnect is
// followed by query invalidation (the REST refetch IS the backfill).
import type { Event, ServerFrame } from '@flow/shared';

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting';

export interface SocketHandlers {
  onEvent(event: Event): void;
  onStatus(status: SocketStatus): void;
}

export class SocketClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 500;

  constructor(
    private readonly token: string,
    private readonly handlers: SocketHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  sendTyping(channelId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'typing', channelId }));
    }
  }

  private connect(): void {
    if (this.stopped) return;
    this.handlers.onStatus(this.backoff === 500 ? 'connecting' : 'reconnecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/v1/ws`);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ op: 'auth', token: this.token }));
    ws.onmessage = (msg) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(msg.data)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.op === 'ping') {
        ws.send(JSON.stringify({ op: 'pong' }));
      } else if (frame.op === 'hello') {
        this.backoff = 500;
        this.handlers.onStatus('connected');
      } else if (frame.op === 'event') {
        this.handlers.onEvent(frame.event);
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.handlers.onStatus('reconnecting');
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 15_000);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }
}
