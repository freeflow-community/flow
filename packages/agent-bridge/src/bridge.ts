// The bridge daemon: consume Flow events over WS, exec a coding-agent CLI
// headlessly per conversation, post the reply back (AGENTS_DESIGN.md).
//
// One CLI session per conversation: (channelId, threadRootId) → session uuid,
// `--session-id` on the first turn, `--resume` after. Conversations run
// concurrently (cap N), messages within one conversation run serially.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  ChannelDTO,
  Event,
  MessageDTO,
  ReactionEventData,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
} from '@flow/shared';
import { resolveWorkspace, type BridgeConfig } from './config.js';
import { FlowApi } from './api.js';
import { attachmentFilename, formatAttachments } from './attachments.js';
import { FlowSocket } from './gateway.js';
import { ProgressReporter } from './progress.js';
import { killAllRuntimes, runRuntime, type RunResult } from './runtime.js';
import { EXIT_RESTART, EXIT_UPDATE } from './supervisor.js';
import { currentVersion, isOutdated, latestPublishedVersion } from './version.js';

const THINKING_PREFIX = '🤖 *thinking…*';
/** Cap on salvaged text in a failure reply (the API caps a body at 12000). */
const SALVAGE_LIMIT = 4000;
/**
 * React with this on a thinking row to stop the turn (issue #67). A reaction
 * is the signal because every client can already send one — no new endpoint,
 * no new event type — and it names the exact run: the row is the turn.
 */
export const INTERRUPT_EMOJI = '🛑';
/** Typed equivalent of the button, for clients that don't draw one yet. */
const INTERRUPT_COMMANDS = new Set(['/stop', '/interrupt']);

/** A note plus whatever the agent managed to say before the turn ended. */
function withSalvage(note: string, text: string): string {
  const salvaged = text.trim();
  if (!salvaged) return note;
  const capped =
    salvaged.length > SALVAGE_LIMIT ? `${salvaged.slice(0, SALVAGE_LIMIT - 1).trimEnd()}…` : salvaged;
  return `${note}\n\nWhere I got to:\n\n${capped}`;
}

/**
 * What a failed turn posts. An expired run has no final result event, and the
 * thinking status line is deleted on the way out, so without this an agent that
 * worked for hours leaves nothing behind but an error string.
 */
export function failureReply(result: RunResult): string {
  return withSalvage(`🤖 sorry — I hit an error (${result.error ?? 'unknown'}).`, result.text);
}

/**
 * What a stopped turn posts in place of its status row. Not an apology — the
 * stop was asked for — but it still carries the partial work, which is the
 * whole point of stopping a long run rather than letting it time out.
 */
export function interruptReply(result: RunResult, byUserId: string | null): string {
  return withSalvage(`⏹ Stopped${byUserId ? ` by <@${byUserId}>` : ''}.`, result.text);
}

/** Per-agent scratch dir (0700) for the bridge's own runtime state: the task
 * IPC socket and the relaunch note a restart posts back from. The agent id is
 * *hashed short* deliberately: a unix socket path tops out at ~104 bytes on
 * macOS (`sun_path`), and tmpdir there is already ~50 (`/var/folders/…`) — a
 * full uuid in the dir name pushed `task.sock` over the limit (EINVAL). */
export function bridgeStateDir(agentId: string): string {
  const short = createHash('sha256').update(agentId).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `flow-bridge-${short}`);
}

/** Where the task-handoff IPC listens: a per-agent unix socket (named pipe on
 * Windows). The per-run MCP env carries it as FLOW_BRIDGE_SOCK. */
export function taskSocketPath(agentId: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\flow-bridge-${agentId}`;
  return path.join(bridgeStateDir(agentId), 'task.sock');
}

/** Written before a `/update` or `/restart` exit; read on the next startup so
 * the relaunched daemon can report back where it was asked. */
interface RelaunchNote {
  channelId: string;
  threadRootId?: string;
  fromVersion: string | null;
  update: boolean;
  at: string;
}

/** A runtime turn in flight, so an interrupt can find and end it. */
interface LiveRun {
  controller: AbortController;
  progress: ProgressReporter;
  /** Who pressed stop — named in the reply. Null until someone does. */
  stoppedBy: string | null;
}

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
  /** Set once we learn we are no longer a member of this workspace (#340).
   * Every workspace-scoped call would 404 from here on, so we stop making
   * them rather than logging a failed refresh on every event. */
  private departed = false;
  private conversations = new Map<string, Conversation>();
  /** Channels homing a start_task run. The bridge converses in them DM-style —
   * top-level, one session — so the run and human interjections share context.
   * In-memory: a bridge restart kills the run anyway (killAllRuntimes), after
   * which the channel reverts to ordinary owned-channel threading. */
  private taskChannels = new Set<string>();
  /** threadRootId → "we've spoken in this thread" (see inThread). */
  private threadParticipation = new Map<string, boolean>();
  /** convKey → the turn currently running there, for `/stop` and 🛑. */
  private liveRuns = new Map<string, LiveRun>();
  private readonly sem: Semaphore;
  private refreshTimer: NodeJS.Timeout | null = null;
  private ipcServer: http.Server | null = null;
  private taskSock: string | null = null;

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
    // #357: an agent can belong to several workspaces; this process serves one.
    this.workspace = resolveWorkspace(await this.api.myWorkspaces(), this.cfg.workspace);
    await this.refreshDirectory();
    this.log(
      `${this.me.displayName} <@${this.me.id}> online in "${this.workspace.name}" — ` +
        `scope=${this.cfg.eventScope}+DMs progress=${this.cfg.progress} runtime=${this.cfg.runtime.kind} cwd=${this.cfg.runtime.cwd}`,
    );
    this.socket = new FlowSocket({
      serverUrl: this.cfg.serverUrl,
      token: this.cfg.agentToken,
      // one process, one workspace (#357) — so tell the server, or it lights
      // our presence dot in every workspace we belong to (#364)
      workspaces: [this.workspace.id],
      onEvent: (ev) => this.handleEvent(ev),
      log: (m) => this.log(m),
    });
    this.socket.connect();
    this.startTaskIpc();
    // Best-effort staleness check — never blocks startup or crashes on failure.
    void this.checkVersion();
    void this.reportRelaunch();
  }

  /** After a `/update` / `/restart` relaunch, confirm we're back — in the
   * conversation that asked, with the version the update actually landed on. */
  private async reportRelaunch(): Promise<void> {
    const notePath = path.join(bridgeStateDir(this.me.id), 'relaunch.json');
    let note: RelaunchNote;
    try {
      note = JSON.parse(fs.readFileSync(notePath, 'utf8')) as RelaunchNote;
    } catch {
      return; // no note, or unreadable — nothing to report
    }
    fs.rmSync(notePath, { force: true });
    // A stale note (the relaunch happened long ago, e.g. the machine slept
    // through it) would post into a conversation that has moved on.
    if (Date.now() - Date.parse(note.at) > 15 * 60_000) return;
    let now: string | null = null;
    try {
      now = currentVersion();
    } catch {
      /* version unknown — still report we're back */
    }
    const version =
      note.update && note.fromVersion && now === note.fromVersion
        ? `still v${now} — the update didn't take; check the supervisor log`
        : `v${now ?? 'unknown'}${note.update && note.fromVersion ? ` (was v${note.fromVersion})` : ''}`;
    await this.api
      .sendMessage(note.channelId, `🔄 back online — ${version}.`, note.threadRootId || undefined)
      .catch((err: Error) => this.log(`relaunch report failed: ${err.message}`));
  }

  /**
   * Local IPC for `start_task`: the flow MCP server (a subprocess of the
   * runtime CLI, so always on this machine) POSTs { channelId, prompt } here
   * to hand long-running work off to a run homed in that channel, freeing the
   * conversation it was asked in. A unix socket in a 0700 directory (named
   * pipe on Windows) — the same local trust boundary as agent.json. Failure to
   * listen only loses the tool, never the bridge.
   */
  private startTaskIpc(): void {
    const sock = taskSocketPath(this.me.id);
    try {
      if (process.platform !== 'win32') {
        fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
        fs.rmSync(sock, { force: true }); // stale socket from a previous run
      }
      const server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/task') {
          res.writeHead(404).end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
          if (body.length > 256 * 1024) req.destroy(); // a prompt, not a payload
        });
        req.on('end', () => {
          void (async () => {
            let out: { ok: true; note: string } | { error: string };
            try {
              out = await this.startTask(JSON.parse(body) as Record<string, unknown>);
            } catch (err) {
              out = { error: (err as Error).message };
            }
            res.writeHead('error' in out ? 400 : 200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(out));
          })();
        });
      });
      server.on('error', (err: Error) => this.log(`task ipc error: ${err.message}`));
      server.listen(sock, () => this.log(`task ipc listening on ${sock}`));
      server.unref();
      this.ipcServer = server;
      this.taskSock = sock;
    } catch (err) {
      this.log(`task ipc unavailable: ${(err as Error).message}`);
    }
  }

  /**
   * Hand work off to a run of the agent homed in `channelId`, seeded with
   * `prompt` as its entire instructions (it inherits nothing from the calling
   * conversation). The channel becomes a task channel — see `taskChannels` —
   * so the run's progress, its replies, and anything humans say there all
   * share one top-level session. Returns as soon as the turn is queued.
   */
  async startTask(params: Record<string, unknown>): Promise<{ ok: true; note: string } | { error: string }> {
    const channelId = typeof params.channelId === 'string' ? params.channelId : '';
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
    if (!channelId || !prompt) return { error: 'start_task needs channelId and prompt' };
    if (!this.channels.has(channelId)) {
      await this.refreshDirectory().catch((err: Error) => this.log(`directory refresh failed: ${err.message}`));
    }
    const chan = this.channels.get(channelId);
    if (!chan) return { error: 'no such channel' };
    if (!chan.isMember) return { error: 'you are not a member of that channel — create or join it first' };
    const requester =
      typeof params.userId === 'string' && this.members.has(params.userId) ? params.userId : this.me.id;
    const sourceChannelId = typeof params.sourceChannelId === 'string' ? params.sourceChannelId : '';
    this.taskChannels.add(channelId);
    // Provenance for the record: the channel says where the run came from.
    if (sourceChannelId && sourceChannelId !== channelId) {
      await this.api
        .sendMessage(
          channelId,
          `⚙️ starting a task run here — handed off from ${this.channelLabel(sourceChannelId)}` +
            `${requester !== this.me.id ? ` for <@${requester}>` : ''}.`,
        )
        .catch((err: Error) => this.log(`task kickoff post failed: ${err.message}`));
    }
    this.enqueue({
      id: `task-${randomUUID()}`,
      channelId,
      userId: requester,
      threadRootId: null,
      clientMsgId: `task-${randomUUID()}`,
      body: prompt,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      pinnedBy: null,
      systemKind: null,
      scheduled: false,
      replyCount: 0,
      lastReplyAt: null,
      replyParticipantUserIds: [],
      reactions: [],
      files: [],
      unfurls: [],
    });
    return { ok: true, note: `task run queued in ${this.channelLabel(channelId)}` };
  }

  /**
   * On startup, compare our installed version with the latest on npm. If we're
   * behind, log it and post one notice to the first non-DM channel we're in.
   * Every failure path (offline, registry down, no channel) is swallowed —
   * this is advisory, not a gate.
   */
  private async checkVersion(): Promise<void> {
    let current: string;
    try {
      current = currentVersion();
    } catch (err) {
      this.log(`version check skipped: ${(err as Error).message}`);
      return;
    }
    const latest = await latestPublishedVersion();
    if (!latest || !isOutdated(current, latest)) return;
    this.log(`⚠️ version ${current} is behind latest ${latest} on npm — restart after updating`);
    const chan = [...this.channels.values()].find(
      (c) => c.isMember && c.kind !== 'dm' && c.kind !== 'group_dm',
    );
    if (!chan) return;
    await this.api
      .sendMessage(
        chan.id,
        `⚠️ I'm running flow-agent-bridge v${current}, but v${latest} is available on npm. ` +
          `Send \`/update\` (mention me in a channel, or DM it) and I'll update and restart myself.`,
      )
      .catch((err: Error) => this.log(`version notice post failed: ${err.message}`));
  }

  stop(): void {
    this.socket?.close();
    this.ipcServer?.close();
    this.ipcServer = null;
    if (this.taskSock && process.platform !== 'win32') fs.rmSync(this.taskSock, { force: true });
    this.taskSock = null;
    // Runtimes run detached (own process group) so expiry can kill their whole
    // subprocess tree — the flip side is they outlive us unless we end them.
    killAllRuntimes();
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
    if (this.departed || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshDirectory().catch((err: Error) => this.log(`directory refresh failed: ${err.message}`));
    }, 1000);
    this.refreshTimer.unref();
  }

  /**
   * We were removed from the workspace — the sponsor left and took us with
   * them, or an admin removed us (#340). Nothing here is recoverable without a
   * re-invite, so say so once and go quiet: the alternative is a directory
   * refresh that 404s on every subsequent event. The process stays up so a
   * supervisor sees a clean exit reason rather than a crash.
   */
  private handleOwnRemoval(): void {
    if (this.departed) return;
    this.departed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.channels.clear();
    this.members.clear();
    this.log(
      `removed from workspace ${this.workspace.name} — no longer serving it ` +
        `(ask an admin to re-invite this agent, then restart the bridge)`,
    );
  }

  private handleEvent(ev: Event): void {
    // One process, one workspace (#357). The socket carries every workspace the
    // agent belongs to, so anything from elsewhere belongs to a sibling process
    // — acting on it here would have this agent answering in a room it was
    // never pointed at, with the wrong workspace id on every reply.
    if (ev.workspaceId && ev.workspaceId !== this.workspace.id) return;
    // Our own workspace-level departure, before anything else: a `member.left`
    // with no channelId naming us is the last event we can act on.
    if (ev.type === 'member.left' && !ev.channelId && (ev.data as { userId?: string })?.userId === this.me.id) {
      this.handleOwnRemoval();
      return;
    }
    // Someone else's membership change while we're out: nothing to refresh.
    if (this.departed) return;
    if (ev.type === 'member.joined' || ev.type === 'member.left' || ev.type === 'channel.created') {
      this.scheduleRefresh();
      return;
    }
    if (ev.type === 'reaction.added') {
      void this.handleReaction(ev.data as ReactionEventData);
      return;
    }
    if (ev.type !== 'message.created' && ev.type !== 'thread.reply') return;
    void this.handleMessage(ev.data as MessageDTO);
  }

  /**
   * The Interrupt button: 🛑 on a thinking row stops the turn that row belongs
   * to. Deliberately not routed through `inScope` — stopping an agent is not
   * talking to it, so it works from any channel we're in, mention or not.
   */
  private async handleReaction(data: ReactionEventData): Promise<void> {
    if (data.emoji !== INTERRUPT_EMOJI || data.userId === this.me.id) return;
    for (const [key, run] of this.liveRuns) {
      if (run.progress.statusId !== data.messageId) continue;
      this.stopRun(key, run, data.userId);
      return;
    }
    // No live run owns that row. Either the turn just finished (harmless), or
    // the row was orphaned by a bridge that died mid-turn and nothing ever
    // reaped it — in which case pressing Interrupt should still clear it.
    await this.reapOrphanStatus(data.messageId, data.channelId);
  }

  /** Abort the runtime; `processMessage` posts the reply when it unwinds. */
  private stopRun(key: string, run: LiveRun, byUserId: string | null): void {
    if (run.controller.signal.aborted) return;
    run.stoppedBy = byUserId;
    this.log(`interrupting the run in ${key}${byUserId ? ` (asked by ${this.senderLabel(byUserId)})` : ''}`);
    run.controller.abort();
  }

  /**
   * Clear a `🤖 *thinking…*` row of ours that no run owns any more. Verified
   * against the channel's recent messages first: we only ever hard-delete our
   * own status rows, never a real message someone reacted 🛑 to.
   */
  private async reapOrphanStatus(messageId: string, channelId: string): Promise<void> {
    try {
      const page = await this.api.listMessages(channelId, 30);
      const row = page.messages.find((m) => m.id === messageId);
      if (!row || row.deletedAt || row.userId !== this.me.id || !row.body.startsWith(THINKING_PREFIX)) return;
      await this.api.deleteMessage(messageId, { hard: true });
      this.log(`reaped an orphaned status row in ${this.channelLabel(channelId)}`);
    } catch (err) {
      this.log(`orphan status reap failed: ${(err as Error).message}`);
    }
  }

  private async handleMessage(msg: MessageDTO): Promise<void> {
    // a message can beat the debounced directory refresh (e.g. a brand-new DM)
    if (!this.channels.has(msg.channelId) || !this.members.has(msg.userId)) {
      await this.refreshDirectory().catch((err: Error) => this.log(`directory refresh failed: ${err.message}`));
    }
    if (!(await this.inScope(msg))) return;
    // Bridge commands, not runtime turns. A leading mention of us is stripped
    // first, so "@Bot /update" works in a channel (where the mention is what
    // put the message in scope at all).
    const command = msg.body.replace(new RegExp(`^\\s*<@${this.me.id}>\\s*`), '').trim();
    if (command === '/reset') return this.handleReset(msg);
    if (INTERRUPT_COMMANDS.has(command)) return this.handleStop(msg);
    if (command === '/update' || command === '/restart') {
      return this.handleRelaunch(msg, command === '/update');
    }
    this.enqueue(msg);
  }

  /** Swappable in tests — the real thing takes the process down. */
  exitProcess: (code: number) => void = (code) => process.exit(code);
  /** Swappable in tests — the real thing asks the npm registry. */
  fetchLatestVersion: () => Promise<string | null> = latestPublishedVersion;

  /**
   * `/update` and `/restart`: acknowledge, leave a note to report back from,
   * and exit with the code the supervisor reads (see supervisor.ts). Without a
   * supervisor (FLOW_BRIDGE_SUPERVISED unset means we *are* the supervisor's
   * child in the normal topology — but a bare `run` under an external process
   * manager also lands here) the exit still behaves: most managers restart on
   * a nonzero exit, and a plain terminal run just stops.
   */
  private async handleRelaunch(msg: MessageDTO, update: boolean): Promise<void> {
    const replyRoot = this.replyRoot(msg);
    const say = (text: string): Promise<unknown> =>
      this.api.sendMessage(msg.channelId, text, replyRoot).catch((err: Error) => this.log(`relaunch ack failed: ${err.message}`));
    let current: string | null = null;
    try {
      current = currentVersion();
    } catch {
      /* unknown version — update can still proceed */
    }
    if (update) {
      const latest = await this.fetchLatestVersion();
      if (current && latest && !isOutdated(current, latest)) {
        await say(`🤖 already running the latest flow-agent-bridge (v${current}) — nothing to update. (\`/restart\` relaunches without updating.)`);
        return;
      }
    }
    const busy = [...this.conversations.values()].filter((c) => c.running).length;
    const cutShort = busy > 0 ? ` ${busy} in-flight run${busy === 1 ? '' : 's'} will be cut short.` : '';
    await say(
      update
        ? `🤖 updating${current ? ` from v${current}` : ''} and restarting — back in a minute.${cutShort}`
        : `🤖 restarting — back in a moment.${cutShort}`,
    );
    try {
      const dir = bridgeStateDir(this.me.id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const note: RelaunchNote = {
        channelId: msg.channelId,
        ...(replyRoot ? { threadRootId: replyRoot } : {}),
        fromVersion: current,
        update,
        at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(dir, 'relaunch.json'), JSON.stringify(note), { mode: 0o600 });
    } catch (err) {
      this.log(`relaunch note not written: ${(err as Error).message}`);
    }
    this.log(update ? 'update requested — exiting for the supervisor' : 'restart requested — exiting for the supervisor');
    this.stop();
    // A beat for the WS close + log flush, mirroring the signal path.
    setTimeout(() => this.exitProcess(update ? EXIT_UPDATE : EXIT_RESTART), 300);
  }

  /**
   * Consecutive agent-authored messages per channel since a human last spoke
   * (our own posts count — they are agent traffic too). The circuit breaker
   * (`agentChainLimit`) reads this: a channel where only agents have been
   * talking for a while is a loop, whatever the messages say.
   */
  private agentChain = new Map<string, number>();

  /** Sender gating + self/agent loop guard + event-scope filter. */
  private async inScope(msg: MessageDTO): Promise<boolean> {
    if (msg.deletedAt) return false;
    const sender = this.members.get(msg.userId);
    // Chain accounting first, on every real message we can attribute — a
    // human speaking re-arms the channel; agent chatter (ours included)
    // burns it down. Status/system lines don't count either way.
    let chain = 0;
    if (sender && !msg.systemKind && !msg.body.startsWith(THINKING_PREFIX)) {
      chain = sender.isAgent ? (this.agentChain.get(msg.channelId) ?? 0) + 1 : 0;
      this.agentChain.set(msg.channelId, chain);
    }
    if (msg.userId === this.me.id) return false; // never our own messages (incl. MCP-sent)
    if (!sender) return false; // only workspace members
    if (sender.isAgent && !this.cfg.respondToAgents) return false; // agent-to-agent loop guard
    if (sender.isAgent && this.cfg.agentChainLimit > 0 && chain > this.cfg.agentChainLimit) {
      this.log(
        `loop breaker: ${chain} consecutive agent messages in ${msg.channelId} — ignoring until a human speaks`,
      );
      return false;
    }
    // Agent-to-agent traffic must be an explicit hand-off: with
    // agentMentionsOnly, an agent's message triggers us only when it
    // @-mentions us — including in DMs, where the ping-pong loops live.
    if (sender.isAgent && this.cfg.agentMentionsOnly && !msg.body.includes(`<@${this.me.id}>`)) return false;
    const chan = this.channels.get(msg.channelId);
    if (!chan?.isMember) return false; // only channels we're in
    // Channel event lines ("Alice joined the channel") are notices for humans,
    // not something addressed to us — someone joining a room we own is not a
    // request. Filtered before the DM branch so no systemKind can ever wake a
    // run, whatever channel kind the server posts it in.
    if (msg.systemKind) return false;
    if (chan.kind === 'dm' || chan.kind === 'group_dm') return true;
    if (msg.body.startsWith(THINKING_PREFIX)) return false; // another agent's status line
    if (this.cfg.eventScope === 'all') return true;
    if (msg.body.includes(`<@${this.me.id}>`)) return true; // @-mention
    // A channel we created is ours: every top-level message in it is addressed
    // to us, mention or not. Same for a channel homing a start_task run,
    // whoever created it — talking there is talking to the run. Thread replies
    // are excluded deliberately — those stay governed by inThread, so a side
    // conversation under someone else's message doesn't drag us in.
    if (!msg.threadRootId && (chan.createdBy === this.me.id || this.taskChannels.has(chan.id))) return true;
    // Every reply in a thread we're part of, mentioned or not.
    if (msg.threadRootId) return this.inThread(msg.channelId, msg.threadRootId);
    return false;
  }

  /**
   * Where our reply to `msg` goes.
   *
   * A thread reply stays in its thread. A top-level *channel* message we've
   * decided to answer (an @-mention, or any message under eventScope 'all')
   * is answered in a NEW thread rooted at that message, so the agent's
   * back-and-forth never fills the channel's main view. DMs are exempt — the
   * DM already is the conversation, and threading it would be noise.
   */
  private replyRoot(msg: MessageDTO): string | undefined {
    if (msg.threadRootId) return msg.threadRootId;
    const chan = this.channels.get(msg.channelId);
    // A channel we own converses DM-style: the channel *is* the conversation.
    // Top-level replies keep the run's log linear, and — via convKey — route
    // every top-level message into the run's own session, which is what lets
    // a human interject with the run's full context.
    //
    // "Ours" must mean the same here as it does in inScope, or the two
    // disagree: a channel the agent created is in scope for top-level
    // messages, so it answers them, but if only `taskChannels` counted as
    // owned it would answer them in a *new thread* — and each thread is its
    // own convKey, so the reply also lost the run's context. That is the
    // common case, not a corner: a dispatched run has no start_task to call
    // (it is the fallback path in work-project-tasks/SKILL.md §3), so it
    // creates its own #task-N channel and `taskChannels` never learns of it.
    // `taskChannels` is in-memory besides, so a bridge restart drops even the
    // channels that did register.
    if (this.taskChannels.has(msg.channelId) || chan?.createdBy === this.me.id) return undefined;
    if (!chan || chan.kind === 'dm' || chan.kind === 'group_dm') return undefined;
    return msg.id;
  }

  /** One CLI session per reply target, so a thread we open continues that session. */
  private convKey(msg: MessageDTO): string {
    return `${msg.channelId}|${this.replyRoot(msg) ?? ''}`;
  }

  /**
   * Are we a participant in this thread? Once the agent has spoken in a
   * thread it answers *every* subsequent reply there, mention or not — a
   * thread it's in is a conversation with it. Checked against live sessions
   * first, then the thread itself (which survives a bridge restart), with the
   * verdict cached per root.
   */
  private async inThread(channelId: string, rootId: string): Promise<boolean> {
    if (this.conversations.has(`${channelId}|${rootId}`)) return true;
    const cached = this.threadParticipation.get(rootId);
    if (cached !== undefined) return cached;
    let joined = false;
    try {
      const msgs = await this.api.listThread(rootId);
      joined = msgs.some((m) => m.userId === this.me.id && !m.deletedAt);
    } catch (err) {
      // Don't cache a lookup failure — a transient error would mute the thread.
      this.log(`thread lookup failed for ${rootId}: ${(err as Error).message}`);
      return false;
    }
    this.threadParticipation.set(rootId, joined);
    return joined;
  }

  /**
   * `/stop` — the Interrupt button for anyone whose client doesn't draw one.
   * Handled here, on the event, rather than queued: a turn is running, and a
   * queued stop would only be read once that turn was over.
   */
  private async handleStop(msg: MessageDTO): Promise<void> {
    const key = this.convKey(msg);
    const run = this.liveRuns.get(key);
    if (run) return this.stopRun(key, run, msg.userId);
    await this.api
      .sendMessage(msg.channelId, '🤖 nothing running here to stop.', this.replyRoot(msg))
      .catch((err: Error) => this.log(`stop reply failed: ${err.message}`));
  }

  private async handleReset(msg: MessageDTO): Promise<void> {
    this.conversations.delete(this.convKey(msg));
    await this.api
      .sendMessage(msg.channelId, '🤖 context reset — the next message starts a fresh session.', this.replyRoot(msg))
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
          await this.processMessage(conv, msg, key);
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

  private async processMessage(conv: Conversation, msg: MessageDTO, key: string): Promise<void> {
    // Everything about this turn — status line, MCP context, the reply itself
    // — targets the same thread (a new one when we're answering a top-level
    // channel message).
    const replyRoot = this.replyRoot(msg);
    const progress = new ProgressReporter(
      this.api,
      this.socket,
      this.cfg.progress,
      this.cfg.relayText,
      msg.channelId,
      replyRoot,
      (m) => this.log(m),
    );
    progress.start();
    const mcpConfigPath = this.cfg.runtime.mcp ? this.writeMcpConfig(msg, replyRoot) : undefined;
    // Registered before the runtime starts, so a stop that arrives in the gap
    // still lands: runRuntime checks the signal before it spawns anything.
    const live: LiveRun = { controller: new AbortController(), progress, stoppedBy: null };
    this.liveRuns.set(key, live);
    try {
      const prompt = await this.buildPrompt(conv, msg);
      const run = (resume: boolean) =>
        runRuntime(this.cfg.runtime, {
          sessionId: conv.sessionId,
          resume,
          prompt,
          systemPrompt: this.buildSystemPrompt(msg, mcpConfigPath !== undefined),
          mcpConfigPath,
          signal: live.controller.signal,
          onToolStep: (step) => progress.onStep(step),
          onText: (text) => progress.onText(text),
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
      // The reply we're about to post is (for claude) the last text block we
      // already relayed — hand it over so the narration doesn't end on it.
      await progress.finish(result.text);
      if (result.interrupted) {
        // Asked for, not broken: say who stopped it and hand back the partial
        // work. The session survives (SIGTERM let the CLI flush its
        // transcript), so the next message continues where this left off.
        this.log('run stopped by request');
        if (result.sawSession) conv.started = true;
        await this.api.sendMessage(msg.channelId, interruptReply(result, live.stoppedBy), replyRoot).catch(() => {});
        if (replyRoot) this.threadParticipation.set(replyRoot, true);
        return;
      }
      if (result.ok) {
        conv.started = true;
        const text = result.text.trim();
        if (text.length > 0) {
          await this.api.sendMessage(msg.channelId, text, replyRoot);
          // We've now spoken here — every later reply in this thread is ours to answer.
          if (replyRoot) this.threadParticipation.set(replyRoot, true);
        }
      } else {
        this.log(`runtime error: ${result.error ?? 'unknown'}`);
        // Self-heal for the NEXT turn: a run the CLI got far enough to create a
        // session for (max-turns, or an expiry that killed real work) is
        // resumable with all its context; anything else retries on a fresh id.
        if (!conv.started) {
          if (result.sawSession) conv.started = true;
          else conv.sessionId = randomUUID();
        }
        await this.api.sendMessage(msg.channelId, failureReply(result), replyRoot).catch(() => {});
      }
    } finally {
      if (this.liveRuns.get(key) === live) this.liveRuns.delete(key);
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
    const threadNote = msg.threadRootId
      ? ' (inside a thread — replies stay in it)'
      : this.replyRoot(msg)
        ? ' (your reply opens a thread on that message, and the conversation continues there)'
        : '';
    const roster = [...this.members.values()]
      .filter((m) => m.userId !== this.me.id)
      .slice(0, 50)
      .map((m) => `${m.displayName}${m.isAgent ? ' (agent)' : ''} = <@${m.userId}>`)
      .join(', ');
    const lines = [
      `You are ${this.me.displayName}, an AI agent participating in the Flow workspace "${this.workspace.name}" as user <@${this.me.id}>.`,
      `You are conversing in ${this.channelLabel(msg.channelId)}${threadNote}. Each incoming prompt begins with a bracketed metadata line identifying the sender — it is context, not part of the message.`,
      `Reply in concise chat style; Flow renders markdown. Mention users by writing <@userId> literally, e.g. <@${msg.userId}>.`,
      roster ? `Workspace members: ${roster}.` : '',
      mcp
        ? 'You have Flow MCP tools: send_message, react, upload_file, download_file (fetch a file attached to any message — read_messages notes attachments with their file ids), search_history, set_avatar (change your own profile picture from a local image), plus channel operations (list_channels, list_users, join_channel, leave_channel, create_channel, invite_to_channel — add several userIds in one call, read_messages — newest first, page with before=<oldest id>), and start_task — hand long-running work off to a separate run of yourself homed in another channel (that channel becomes the run’s conversation: progress, replies and human steering all live there; the prompt must be self-contained, and after handing off you reply here with a one-line pointer instead of doing the work). Messages sent with send_message deliver immediately. Your final response text is ALSO posted to the conversation — if you already replied via send_message, keep the final text short or empty.'
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
        const lines = history.map((m) => `${this.senderLabel(m.userId)}: ${m.body}${formatAttachments(m.files)}`);
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
      const dest = path.join(dir, attachmentFilename(f.id, f.name));
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
  private writeMcpConfig(msg: MessageDTO, replyRoot: string | undefined): string | undefined {
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
            // The thread we're answering in — for a top-level channel message
            // that's the new thread rooted at it, so MCP sends land there too.
            FLOW_THREAD_ROOT_ID: replyRoot ?? '',
            // Who the agent is working for this run — the author of the
            // message it's responding to. Default recipient for create_artifact.
            FLOW_USER_ID: msg.userId,
            // Where start_task reaches the daemon; empty when IPC failed to start.
            FLOW_BRIDGE_SOCK: this.taskSock ?? '',
          },
        },
      },
    };
    const p = path.join(os.tmpdir(), `flow-mcp-${randomUUID()}.json`);
    fs.writeFileSync(p, JSON.stringify(cfg));
    return p;
  }
}
