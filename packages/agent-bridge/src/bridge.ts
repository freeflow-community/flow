// The bridge daemon: consume Flow events over WS, exec a coding-agent CLI
// headlessly per conversation, post the reply back (AGENTS_DESIGN.md).
//
// One CLI session per conversation: (channelId, threadRootId) → session uuid,
// `--session-id` on the first turn, `--resume` after. Conversations run
// concurrently (cap N), messages within one conversation run serially.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ChannelDTO, Event, MessageDTO, UserDTO, WorkspaceDTO, WorkspaceMemberDTO } from '@flow/shared';
import type { BridgeConfig } from './config.js';
import { FlowApi } from './api.js';
import { FlowSocket } from './gateway.js';
import { ProgressReporter } from './progress.js';
import { runRuntime } from './runtime.js';

const THINKING_PREFIX = '🤖 *thinking…*';

interface Conversation {
  sessionId: string;
  /** true once a runtime turn has completed for this session (→ --resume). */
  started: boolean;
  queue: MessageDTO[];
  running: boolean;
}

class Semaphore {
  private waiters: Array<() => void> = [];
  constructor(private slots: number) {}
  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.slots += 1;
  }
}

export class AgentBridge {
  private readonly api: FlowApi;
  private socket!: FlowSocket;
  private me!: UserDTO;
  private workspace!: WorkspaceDTO;
  private channels = new Map<string, ChannelDTO>();
  private members = new Map<string, WorkspaceMemberDTO>();
  private conversations = new Map<string, Conversation>();
  private readonly sem: Semaphore;
  private refreshTimer: NodeJS.Timeout | null = null;

  private logStream: fs.WriteStream | null = null;

  constructor(private readonly cfg: BridgeConfig) {
    this.api = new FlowApi(cfg.serverUrl, cfg.agentToken);
    this.sem = new Semaphore(cfg.concurrency);
    if (cfg.logFile) {
      try {
        // One-shot rotation at 5 MB so the file can't grow unbounded.
        fs.mkdirSync(path.dirname(cfg.logFile), { recursive: true });
        const size = fs.existsSync(cfg.logFile) ? fs.statSync(cfg.logFile).size : 0;
        if (size > 5 * 1024 * 1024) fs.renameSync(cfg.logFile, `${cfg.logFile}.1`);
        this.logStream = fs.createWriteStream(cfg.logFile, { flags: 'a', mode: 0o600 });
        this.logStream.on('error', (err: Error) => {
          console.error(`[bridge] log file error (${err.message}) — continuing on stdout only`);
          this.logStream = null;
        });
      } catch (err) {
        console.error(`[bridge] could not open log file ${cfg.logFile}: ${(err as Error).message}`);
      }
    }
  }

  log(msg: string): void {
    const line = `[bridge ${new Date().toISOString()}] ${msg}`;
    console.log(line);
    this.logStream?.write(line + '\n');
  }

  async start(): Promise<void> {
    this.me = await this.api.me();
    if (!this.me.isAgent) this.log('warning: token belongs to a non-agent user');
    const wss = await this.api.myWorkspaces();
    if (wss.length === 0) throw new Error('agent belongs to no workspace');
    this.workspace = wss[0]!;
    await this.refreshDirectory();
    this.log(
      `${this.me.displayName} <@${this.me.id}> online in "${this.workspace.name}" — ` +
        `scope=${this.cfg.eventScope}+DMs progress=${this.cfg.progress} runtime=${this.cfg.runtime.kind} cwd=${this.cfg.runtime.cwd}`,
    );
    this.socket = new FlowSocket({
      serverUrl: this.cfg.serverUrl,
      token: this.cfg.agentToken,
      onEvent: (ev) => this.handleEvent(ev),
      log: (m) => this.log(m),
    });
    this.socket.connect();
  }

  stop(): void {
    this.socket?.close();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.logStream?.end();
    this.logStream = null;
  }

  private async refreshDirectory(): Promise<void> {
    const [chans, members] = await Promise.all([
      this.api.listChannels(this.workspace.id),
      this.api.listMembers(this.workspace.id),
    ]);
    this.channels = new Map(chans.map((c) => [c.id, c]));
    this.members = new Map(members.map((m) => [m.userId, m]));
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshDirectory().catch((err: Error) => this.log(`directory refresh failed: ${err.message}`));
    }, 1000);
    this.refreshTimer.unref();
  }

  private handleEvent(ev: Event): void {
    if (ev.type === 'member.joined' || ev.type === 'member.left' || ev.type === 'channel.created') {
      this.scheduleRefresh();
      return;
    }
    if (ev.type !== 'message.created' && ev.type !== 'thread.reply') return;
    void this.handleMessage(ev.data as MessageDTO);
  }

  private async handleMessage(msg: MessageDTO): Promise<void> {
    // a message can beat the debounced directory refresh (e.g. a brand-new DM)
    if (!this.channels.has(msg.channelId) || !this.members.has(msg.userId)) {
      await this.refreshDirectory().catch((err: Error) => this.log(`directory refresh failed: ${err.message}`));
    }
    if (!this.inScope(msg)) return;
    if (msg.body.trim() === '/reset') return this.handleReset(msg);
    this.enqueue(msg);
  }

  /** Sender gating + self/agent loop guard + event-scope filter. */
  private inScope(msg: MessageDTO): boolean {
    if (msg.userId === this.me.id) return false; // never our own messages (incl. MCP-sent)
    if (msg.deletedAt) return false;
    const sender = this.members.get(msg.userId);
    if (!sender) return false; // only workspace members
    if (sender.isAgent && !this.cfg.respondToAgents) return false; // agent-to-agent loop guard
    const chan = this.channels.get(msg.channelId);
    if (!chan?.isMember) return false; // only channels we're in
    if (chan.kind === 'dm' || chan.kind === 'group_dm') return true;
    if (msg.body.startsWith(THINKING_PREFIX)) return false; // another agent's status line
    if (this.cfg.eventScope === 'all') return true;
    return msg.body.includes(`<@${this.me.id}>`); // @-mention
  }

  private convKey(msg: MessageDTO): string {
    return `${msg.channelId}|${msg.threadRootId ?? ''}`;
  }

  private async handleReset(msg: MessageDTO): Promise<void> {
    this.conversations.delete(this.convKey(msg));
    await this.api
      .sendMessage(msg.channelId, '🤖 context reset — the next message starts a fresh session.', msg.threadRootId ?? undefined)
      .catch((err: Error) => this.log(`reset reply failed: ${err.message}`));
  }

  private enqueue(msg: MessageDTO): void {
    const key = this.convKey(msg);
    let conv = this.conversations.get(key);
    if (!conv) {
      conv = { sessionId: randomUUID(), started: false, queue: [], running: false };
      this.conversations.set(key, conv);
    }
    conv.queue.push(msg);
    if (!conv.running) void this.runConversation(key, conv);
  }

  /** Serial within a conversation; the semaphore caps cross-conversation parallelism. */
  private async runConversation(key: string, conv: Conversation): Promise<void> {
    conv.running = true;
    try {
      while (conv.queue.length > 0) {
        const msg = conv.queue.shift()!;
        await this.sem.acquire();
        try {
          await this.processMessage(conv, msg);
        } catch (err) {
          this.log(`processing failed: ${(err as Error).message}`);
        } finally {
          this.sem.release();
        }
        // /reset mid-run replaces the map entry; stop pumping the stale one
        if (this.conversations.get(key) !== conv) break;
      }
    } finally {
      conv.running = false;
      if (conv.queue.length > 0 && this.conversations.get(key) === conv) void this.runConversation(key, conv);
    }
  }

  private async processMessage(conv: Conversation, msg: MessageDTO): Promise<void> {
    const progress = new ProgressReporter(
      this.api,
      this.socket,
      this.cfg.progress,
      msg.channelId,
      msg.threadRootId ?? undefined,
      (m) => this.log(m),
    );
    progress.start();
    const mcpConfigPath = this.cfg.runtime.mcp ? this.writeMcpConfig(msg) : undefined;
    try {
      const prompt = await this.buildPrompt(conv, msg);
      const run = (resume: boolean) =>
        runRuntime(this.cfg.runtime, {
          sessionId: conv.sessionId,
          resume,
          prompt,
          systemPrompt: this.buildSystemPrompt(msg, mcpConfigPath !== undefined),
          mcpConfigPath,
          onToolStep: (step) => progress.onStep(step),
          log: (m) => this.log(m),
        });
      let result = await run(conv.started);
      // Session-id collision (a prior turn died after the CLI created the
      // session, e.g. hitting --max-turns): the session exists — flip to
      // --resume and transparently retry this same message, no error posted.
      if (!result.ok && !conv.started && result.error?.includes('already in use')) {
        this.log('session collision — retrying this message with --resume');
        conv.started = true;
        result = await run(true);
      }
      await progress.finish();
      if (result.ok) {
        conv.started = true;
        const text = result.text.trim();
        if (text.length > 0) {
          await this.api.sendMessage(msg.channelId, text, msg.threadRootId ?? undefined);
        }
      } else {
        this.log(`runtime error: ${result.error ?? 'unknown'}`);
        // Self-heal for the NEXT turn: a run that emitted a result event
        // (even an error like max-turns) has a live, resumable session;
        // anything else retries on a fresh session id.
        if (!conv.started) {
          if (result.sawResult) conv.started = true;
          else conv.sessionId = randomUUID();
        }
        await this.api
          .sendMessage(
            msg.channelId,
            `🤖 sorry — I hit an error (${result.error ?? 'unknown'}).`,
            msg.threadRootId ?? undefined,
          )
          .catch(() => {});
      }
    } finally {
      await progress.finish().catch(() => {});
      if (mcpConfigPath) fs.rmSync(mcpConfigPath, { force: true });
    }
  }

  private senderLabel(userId: string): string {
    return this.members.get(userId)?.displayName ?? 'unknown';
  }

  private channelLabel(channelId: string): string {
    const chan = this.channels.get(channelId);
    if (!chan) return 'a channel';
    if (chan.kind === 'dm') return 'a direct message';
    if (chan.kind === 'group_dm') return 'a group direct message';
    return `#${chan.name ?? 'unknown'}`;
  }

  private buildSystemPrompt(msg: MessageDTO, mcp: boolean): string {
    const roster = [...this.members.values()]
      .filter((m) => m.userId !== this.me.id)
      .slice(0, 50)
      .map((m) => `${m.displayName}${m.isAgent ? ' (agent)' : ''} = <@${m.userId}>`)
      .join(', ');
    const lines = [
      `You are ${this.me.displayName}, an AI agent participating in the Flow workspace "${this.workspace.name}" as user <@${this.me.id}>.`,
      `You are conversing in ${this.channelLabel(msg.channelId)}${msg.threadRootId ? ' (inside a thread)' : ''}. Each incoming prompt begins with a bracketed metadata line identifying the sender — it is context, not part of the message.`,
      `Reply in concise chat style; Flow renders markdown. Mention users by writing <@userId> literally, e.g. <@${msg.userId}>.`,
      roster ? `Workspace members: ${roster}.` : '',
      mcp
        ? 'You have Flow MCP tools: send_message, react, upload_file, search_history, set_avatar (change your own profile picture from a local image), plus channel operations (list_channels, list_users, join_channel, leave_channel, read_messages — newest first, page with before=<oldest id>). Messages sent with send_message deliver immediately. Your final response text is ALSO posted to the conversation — if you already replied via send_message, keep the final text short or empty.'
        : 'Your final response text is posted to the conversation as your reply.',
      this.cfg.runtime.systemPromptExtra ?? '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  /** Prompt = optional first-turn history + per-message sender metadata + body. */
  private async buildPrompt(conv: Conversation, msg: MessageDTO): Promise<string> {
    const meta = `[from: ${this.senderLabel(msg.userId)} <@${msg.userId}> in ${this.channelLabel(msg.channelId)}]`;
    let context = '';
    if (!conv.started) {
      const history = await this.fetchHistory(msg).catch(() => []);
      if (history.length > 0) {
        const lines = history.map((m) => `${this.senderLabel(m.userId)}: ${m.body}`);
        context = `[recent conversation history]\n${lines.join('\n')}\n[end of history]\n\n`;
      }
    }
    const attachments = await this.downloadAttachments(msg);
    const fileNote =
      attachments.length > 0
        ? `\n\n[the user attached ${attachments.length} file(s); local copies saved at these paths — Read them as needed (images render when Read):]\n${attachments.map((a) => `- ${a}`).join('\n')}`
        : '';
    return `${context}${meta}\n${msg.body}${fileNote}`;
  }

  /**
   * Message attachments (images, docs) → local temp copies the runtime can
   * Read (Claude's Read tool renders images natively). One bad file never
   * fails the turn; files persist for the session so --resume references
   * stay valid. Demo runtime never spawns a CLI, so skip the downloads.
   */
  private async downloadAttachments(msg: MessageDTO): Promise<string[]> {
    if (this.cfg.runtime.kind === 'demo' || msg.files.length === 0) return [];
    const dir = path.join(os.tmpdir(), 'flow-attachments', this.me.id);
    fs.mkdirSync(dir, { recursive: true });
    const out: string[] = [];
    for (const f of msg.files) {
      const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
      const dest = path.join(dir, `${f.id}-${safe}`);
      try {
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, await this.api.downloadFile(f.id), { mode: 0o600 });
        out.push(`${dest} (${f.mimeType}, ${f.sizeBytes} bytes)`);
      } catch (err) {
        this.log(`attachment download failed for ${f.name}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** History for a session's first turn: the thread so far, or recent channel/DM messages. */
  private async fetchHistory(msg: MessageDTO): Promise<MessageDTO[]> {
    let msgs: MessageDTO[];
    if (msg.threadRootId) {
      msgs = await this.api.listThread(msg.threadRootId);
    } else {
      const page = await this.api.listMessages(msg.channelId, 15);
      msgs = page.messages;
    }
    return msgs
      .filter((m) => m.id !== msg.id && !m.deletedAt && !m.body.startsWith(THINKING_PREFIX))
      .slice(-15);
  }

  /** Per-run MCP config: the flow stdio server with conversation context in env. */
  private writeMcpConfig(msg: MessageDTO): string | undefined {
    const entry = fileURLToPath(new URL('./index.js', import.meta.url));
    if (!fs.existsSync(entry)) {
      this.log('mcp disabled: built entrypoint not found (run pnpm build in packages/agent-bridge)');
      return undefined;
    }
    const cfg = {
      mcpServers: {
        flow: {
          command: process.execPath,
          args: [entry, 'mcp'],
          env: {
            FLOW_SERVER_URL: this.cfg.serverUrl,
            FLOW_AGENT_TOKEN: this.cfg.agentToken,
            FLOW_WORKSPACE_ID: this.workspace.id,
            FLOW_CHANNEL_ID: msg.channelId,
            FLOW_THREAD_ROOT_ID: msg.threadRootId ?? '',
          },
        },
      },
    };
    const p = path.join(os.tmpdir(), `flow-mcp-${randomUUID()}.json`);
    fs.writeFileSync(p, JSON.stringify(cfg));
    return p;
  }
}
