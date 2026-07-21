// Agent-token WS connection — real presence: the agent shows online while
// the daemon runs. Auto-reconnects with backoff; answers heartbeat pings.
import WebSocket from 'ws';
import type { ClientFrame, Event, ServerFrame } from '@flow/shared';

export interface FlowSocketOpts {
  serverUrl: string;
  token: string;
  onEvent(event: Event): void;
  onOpen?(): void;
  log(msg: string): void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];

// The server pings every 30s. If nothing (pings included) arrives for three
// beats the socket is half-dead — the classic case is a laptop sleep: the
// server terminates the connection while the machine is suspended, the FIN
// never reaches us, and 'close' never fires on its own.
const LIVENESS_TIMEOUT_MS = 90_000;
const LIVENESS_CHECK_MS = 15_000;

export class FlowSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;

  constructor(private readonly opts: FlowSocketOpts) {}

  connect(): void {
    if (this.closed) return;
    const wsUrl = this.opts.serverUrl.replace(/^http/, 'ws') + '/v1/ws';
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    let lastActivity = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > LIVENESS_TIMEOUT_MS) {
        this.opts.log('no server heartbeat for 90s (laptop sleep?) — dropping the dead socket');
        ws.terminate(); // fires 'close' → reconnect
      }
    }, LIVENESS_CHECK_MS);
    ws.on('open', () => {
      lastActivity = Date.now();
      this.send({ op: 'auth', token: this.opts.token });
    });
    ws.on('message', (raw: WebSocket.RawData) => {
      lastActivity = Date.now();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(raw)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.op === 'ping') return this.send({ op: 'pong' });
      if (frame.op === 'hello') {
        this.attempt = 0;
        this.opts.log('connected (presence online)');
        this.opts.onOpen?.();
        return;
      }
      if (frame.op === 'event') return this.opts.onEvent(frame.event);
      if (frame.op === 'error') this.opts.log(`ws error: ${frame.code} ${frame.message}`);
    });
    ws.on('close', () => {
      clearInterval(watchdog);
      this.scheduleReconnect();
    });
    ws.on('error', (err: Error) => this.opts.log(`ws error: ${err.message}`));
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.opts.log(`disconnected — reconnecting in ${delay / 1000}s`);
    // NOT unref'd: after a disconnect this timer may be the only handle left
    // on the event loop — an unref'd timer let the whole daemon exit(0) here.
    setTimeout(() => this.connect(), delay);
  }

  sendTyping(channelId: string): void {
    this.send({ op: 'typing', channelId });
  }

  private send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
