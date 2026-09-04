import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { HuddleInviteData, HuddleJoinDTO, HuddleUpdatedData, MessageDTO } from '@flow/shared';
import type { VoiceConfig } from './config.js';

const TERMINAL_INVITE_STATES = new Set(['ended', 'declined', 'missed', 'cancelled']);
let liveKitLoggerInitialized = false;

export interface HuddleVoiceApi {
  acceptHuddleInvite(inviteId: string): Promise<HuddleJoinDTO>;
  declineHuddleInvite(inviteId: string): Promise<unknown>;
  leaveHuddle(channelId: string): Promise<unknown>;
  sendMessage(channelId: string, body: string): Promise<MessageDTO>;
}

export interface LiveVoiceSession {
  close(): Promise<void>;
}

export interface LiveVoiceSessionOptions {
  url: string;
  token: string;
  callerId: string;
  callerName: string;
  agentName: string;
  instructions: string;
  inferenceToken: string;
  config: VoiceConfig;
  runTurn(options: VoiceRuntimeTurnOptions): Promise<VoiceRuntimeTurnResult>;
  onEnded(): void;
  log(message: string): void;
}

export interface VoiceRuntimeTurnOptions {
  /** Latest caller utterance, used by resumable runtimes such as Claude. */
  prompt: string;
  /** Complete in-call transcript, used by stateless runtimes such as Codex. */
  transcript: string;
  signal: AbortSignal;
  onText(text: string): void;
}

export interface VoiceRuntimeTurnResult {
  ok: boolean;
  text: string;
  error?: string;
  interrupted?: boolean;
}

export interface VoiceTranscriptMessage {
  role: 'developer' | 'system' | 'user' | 'assistant';
  text: string;
}

/** Convert LiveKit's call history into inputs for resumable and stateless CLIs. */
export function buildVoiceRuntimeInput(
  messages: readonly VoiceTranscriptMessage[],
  callerName: string,
  agentName: string,
): { prompt: string; transcript: string } | null {
  const conversational = messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') && message.text.trim().length > 0,
  );
  const latestUser = [...conversational]
    .reverse()
    .find((message) => message.role === 'user')
    ?.text.trim();
  if (!latestUser) return null;
  return {
    prompt: latestUser,
    transcript: conversational
      .map((message) => `${message.role === 'user' ? callerName : agentName}: ${message.text.trim()}`)
      .join('\n'),
  };
}

export type LiveVoiceSessionFactory = (options: LiveVoiceSessionOptions) => Promise<LiveVoiceSession>;

interface ActiveCall {
  inviteId: string;
  channelId: string;
  callerId: string;
  session: LiveVoiceSession;
}

export interface HuddleVoiceManagerOptions {
  api: HuddleVoiceApi;
  agentId: string;
  agentName: string;
  config: VoiceConfig;
  callerName(userId: string): string;
  isOneToOneDm(channelId: string): Promise<boolean>;
  buildInstructions(channelId: string, callerId: string): Promise<string>;
  runTurn(options: VoiceRuntimeTurnOptions & {
    sessionId: string;
    resume: boolean;
    systemPrompt: string;
  }): Promise<VoiceRuntimeTurnResult & { sawSession?: boolean }>;
  log(message: string): void;
  sessionFactory?: LiveVoiceSessionFactory | undefined;
}

/**
 * Turns the existing DM ring into a real bot call. The server remains the
 * source of truth for invite and roster state; this class just performs the
 * same accept / join / leave operations as a human client, then attaches a
 * realtime audio participant to the minted LiveKit room token. Speech uses a
 * short-lived inference grant from Flow; reasoning uses the bridge's existing
 * Claude/Codex runtime login.
 */
export class HuddleVoiceManager {
  private active: ActiveCall | null = null;
  private acceptingInviteId: string | null = null;
  private stopping = false;
  private readonly terminalInvites = new Set<string>();
  private readonly handledInvites = new Set<string>();
  private readonly sessionFactory: LiveVoiceSessionFactory;

  constructor(private readonly options: HuddleVoiceManagerOptions) {
    this.sessionFactory = options.sessionFactory ?? createLiveKitVoiceSession;
  }

  get activeChannelId(): string | null {
    return this.active?.channelId ?? null;
  }

  async handleInvite(data: HuddleInviteData): Promise<void> {
    if (this.stopping) return;
    const { invite } = data;
    const target = invite.targets.find((row) => row.userId === this.options.agentId);
    if (!target || invite.startedBy === this.options.agentId) return;

    if (TERMINAL_INVITE_STATES.has(invite.status)) {
      this.rememberTerminal(invite.id);
      if (this.active?.inviteId === invite.id) await this.endActive(`invite ${invite.status}`);
      return;
    }

    // The active update after our accept has target=accepted; it is state
    // confirmation, not a second ring.
    if (invite.status !== 'ringing' || target.status !== 'ringing') return;
    if (this.handledInvites.has(invite.id)) return;
    this.rememberHandled(invite.id);

    if (this.acceptingInviteId || this.active) {
      await this.declineWithMessage(
        invite.id,
        invite.channelId,
        `📞 I’m already in another huddle. Try calling me again after it ends.`,
      );
      return;
    }

    if (!this.options.config.enabled) {
      await this.declineWithMessage(
        invite.id,
        invite.channelId,
        `📞 Voice huddles are turned off for me. Set \`voice.enabled\` to \`true\` in my bridge config and restart me.`,
      );
      return;
    }

    // Reserve the one call slot before the asynchronous directory lookup. Two
    // different rings can arrive on the socket in the same event-loop turn.
    this.acceptingInviteId = invite.id;
    let joined = false;
    try {
      if (!(await this.options.isOneToOneDm(invite.channelId))) {
        await this.declineWithMessage(
          invite.id,
          invite.channelId,
          `📞 I can answer one-to-one Huddles right now, but not group calls yet. Open a DM with me and call from there.`,
        );
        return;
      }
      if (this.stopping || this.terminalInvites.has(invite.id)) return;

      // Accept first so the caller stops hearing a ring immediately. Context
      // loading and model connection happen while both users are in the room.
      const room = await this.options.api.acceptHuddleInvite(invite.id);
      joined = true;
      if (this.stopping || this.terminalInvites.has(invite.id)) {
        await this.leaveQuietly(invite.channelId);
        return;
      }
      const instructions = await this.options.buildInstructions(invite.channelId, invite.startedBy);
      if (this.stopping || this.terminalInvites.has(invite.id)) {
        await this.leaveQuietly(invite.channelId);
        return;
      }
      if (!room.inferenceToken?.trim()) {
        throw new Error('Flow server did not provide an agent inference token; update the server and bridge together');
      }
      const runtimeSessionId = randomUUID();
      let runtimeStarted = false;
      let endedDuringStart = false;
      const session = await this.sessionFactory({
        url: room.url,
        token: room.token,
        callerId: invite.startedBy,
        callerName: this.options.callerName(invite.startedBy),
        agentName: this.options.agentName,
        instructions,
        inferenceToken: room.inferenceToken,
        config: this.options.config,
        runTurn: async (turn) => {
          const result = await this.options.runTurn({
            ...turn,
            sessionId: runtimeSessionId,
            resume: runtimeStarted,
            systemPrompt: instructions,
          });
          if (result.ok || result.sawSession) runtimeStarted = true;
          return result;
        },
        onEnded: () => {
          endedDuringStart = true;
          void this.sessionEnded(invite.id);
        },
        log: this.options.log,
      });

      if (endedDuringStart || this.stopping || this.terminalInvites.has(invite.id)) {
        await session.close().catch(() => undefined);
        await this.leaveQuietly(invite.channelId);
        return;
      }

      this.active = {
        inviteId: invite.id,
        channelId: invite.channelId,
        callerId: invite.startedBy,
        session,
      };
      this.options.log(`answered huddle from ${this.options.callerName(invite.startedBy)}`);
    } catch (error) {
      this.options.log(`could not start huddle voice: ${errorText(error)}`);
      if (joined) await this.leaveQuietly(invite.channelId);
      if (joined && !this.stopping && !this.terminalInvites.has(invite.id)) {
        await this.options.api
          .sendMessage(
            invite.channelId,
            `📞 I answered, but my voice connection couldn’t start. Check the bridge voice configuration and logs, then call me again.`,
          )
          .catch((sendError: unknown) => this.options.log(`could not post voice failure: ${errorText(sendError)}`));
      }
    } finally {
      if (this.acceptingInviteId === invite.id) this.acceptingInviteId = null;
    }
  }

  async handleRoster(data: HuddleUpdatedData): Promise<void> {
    const active = this.active;
    if (!active || active.channelId !== data.channelId) return;
    const ids = new Set(data.participants.map((participant) => participant.userId));
    if (!ids.has(this.options.agentId) || !ids.has(active.callerId)) {
      await this.endActive(!ids.has(active.callerId) ? 'caller left' : 'agent left');
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.endActive('bridge stopping');
  }

  private async declineWithMessage(inviteId: string, channelId: string, message: string): Promise<void> {
    await this.options.api
      .declineHuddleInvite(inviteId)
      .catch((error: unknown) => this.options.log(`could not decline huddle: ${errorText(error)}`));
    await this.options.api
      .sendMessage(channelId, message)
      .catch((error: unknown) => this.options.log(`could not post huddle status: ${errorText(error)}`));
  }

  private async sessionEnded(inviteId: string): Promise<void> {
    const active = this.active;
    if (!active || active.inviteId !== inviteId) return;
    this.active = null;
    await this.leaveQuietly(active.channelId);
    this.options.log('huddle voice session ended');
  }

  private async endActive(reason: string): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.options.log(`ending huddle voice (${reason})`);
    await active.session.close().catch((error: unknown) => this.options.log(`voice close failed: ${errorText(error)}`));
    await this.leaveQuietly(active.channelId);
  }

  private async leaveQuietly(channelId: string): Promise<void> {
    await this.options.api
      .leaveHuddle(channelId)
      .catch((error: unknown) => this.options.log(`could not leave huddle: ${errorText(error)}`));
  }

  private rememberHandled(inviteId: string): void {
    this.handledInvites.add(inviteId);
    if (this.handledInvites.size <= 256) return;
    const oldest = this.handledInvites.values().next().value as string | undefined;
    if (oldest) this.handledInvites.delete(oldest);
  }

  private rememberTerminal(inviteId: string): void {
    this.terminalInvites.add(inviteId);
    if (this.terminalInvites.size <= 256) return;
    const oldest = this.terminalInvites.values().next().value as string | undefined;
    if (oldest) this.terminalInvites.delete(oldest);
  }
}

/**
 * Production session adapter. Imports are deliberately lazy: a text-only
 * bridge can start without loading LiveKit's native RTC binding. Audio uses
 * LiveKit Inference with a short-lived server-minted grant; the LLM below is
 * the bridge's already-authenticated Claude/Codex CLI runtime.
 */
export async function createLiveKitVoiceSession(options: LiveVoiceSessionOptions): Promise<LiveVoiceSession> {
  const [{ Room, RoomEvent }, agents] = await Promise.all([
    import('@livekit/rtc-node'),
    import('@livekit/agents'),
  ]);
  const { inference, llm, voice } = agents;
  if (!liveKitLoggerInitialized) {
    agents.initializeLogger({ pretty: false, level: 'warn' });
    liveKitLoggerInitialized = true;
  }

  /** Adapt the bridge's ordinary runtime contract to LiveKit's streaming LLM. */
  class RuntimeLLM extends llm.LLM {
    label(): string {
      return 'flow.bridge-runtime';
    }

    override get provider(): string {
      return 'flow';
    }

    override get model(): string {
      return 'agent-bridge';
    }

    chat(args: Parameters<InstanceType<typeof llm.LLM>['chat']>[0]) {
      return new RuntimeLLMStream(this, {
        chatCtx: args.chatCtx,
        ...(args.toolCtx ? { toolCtx: args.toolCtx } : {}),
        connOptions: args.connOptions ?? agents.DEFAULT_API_CONNECT_OPTIONS,
      });
    }
  }

  class RuntimeLLMStream extends llm.LLMStream {
    protected async run(): Promise<void> {
      const messages = this.chatCtx.items.filter((item) => item.type === 'message');
      const input = buildVoiceRuntimeInput(
        messages.map((message) => ({ role: message.role, text: message.textContent ?? '' })),
        options.callerName,
        options.agentName,
      );
      if (!input) return;
      const responseId = `bridge-${randomUUID()}`;
      let emitted = false;
      let previous = '';
      const emit = (text: string): void => {
        const clean = text.trim();
        if (!clean || clean === previous || this.abortController.signal.aborted) return;
        previous = clean;
        emitted = true;
        this.queue.put({ id: responseId, delta: { role: 'assistant', content: `${clean} ` } });
      };

      const result = await options.runTurn({
        prompt: input.prompt,
        transcript: input.transcript,
        signal: this.abortController.signal,
        onText: emit,
      });
      if (this.abortController.signal.aborted || result.interrupted) return;
      if (!emitted && result.text.trim()) emit(result.text);
      if (!result.ok) {
        options.log(`voice runtime error: ${result.error ?? 'unknown'}`);
      }
      if (!emitted && !result.ok) {
        emit('I hit a problem while working on that. Please try asking me again.');
      }
    }
  }

  const baseUrl = options.config.inferenceUrl.replace(/\/+$/, '');
  const connect = (path: '/stt' | '/tts', timeout: number, session: Record<string, unknown>) =>
    connectInferenceWebSocket(baseUrl, path, options.inferenceToken, timeout, session);

  // The SDK normally mints an inference token from LIVEKIT_API_SECRET. Flow
  // must never place that project secret on a bot host, so construct the
  // stock streaming codecs and replace only their public WebSocket connector
  // with one authenticated by the narrow, short-lived token from the server.
  const speechToText = new inference.STT({
    model: options.config.sttModel,
    baseURL: baseUrl,
    sampleRate: 16_000,
    encoding: 'pcm_s16le',
    apiKey: 'server-minted-token',
    apiSecret: 'not-used-by-flow-bridge',
  });
  speechToText.connectWs = (timeout) =>
    connect('/stt', timeout, {
      type: 'session.create',
      model: options.config.sttModel,
      settings: { sample_rate: '16000', encoding: 'pcm_s16le', extra: {} },
      connection: { timeout: timeout / 1000, retries: 3 },
    });

  const textToSpeech = new inference.TTS({
    model: options.config.ttsModel,
    voice: options.config.ttsVoice,
    language: 'en',
    baseURL: baseUrl,
    sampleRate: 16_000,
    encoding: 'pcm_s16le',
    apiKey: 'server-minted-token',
    apiSecret: 'not-used-by-flow-bridge',
  });
  textToSpeech.connectWs = (timeout) =>
    connect('/tts', timeout, {
      type: 'session.create',
      model: options.config.ttsModel,
      voice: options.config.ttsVoice,
      language: 'en',
      sample_rate: '16000',
      encoding: 'pcm_s16le',
      extra: {},
      connection: { timeout: timeout / 1000, retries: 3 },
    });

  const room = new Room();
  let closing = false;
  let ended = false;
  let limitTimer: NodeJS.Timeout | undefined;
  const emitEnded = (): void => {
    if (ended) return;
    ended = true;
    if (limitTimer) clearTimeout(limitTimer);
    options.onEnded();
  };

  await room.connect(options.url, options.token, { autoSubscribe: true, dynacast: true });
  room.on(RoomEvent.Disconnected, emitEnded);

  const session = new voice.AgentSession({
    stt: speechToText,
    llm: new RuntimeLLM(),
    tts: textToSpeech,
    vad: null,
    userAwayTimeout: null,
    turnHandling: {
      turnDetection: 'stt',
      interruption: { enabled: true },
    },
  });
  session.on(voice.AgentSessionEventTypes.Error, (event) => {
    options.log(`huddle voice error: ${errorText(event.error)}`);
  });
  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
    if (event.isFinal && event.transcript.trim()) options.log('heard final voice turn');
  });
  session.on(voice.AgentSessionEventTypes.Close, emitEnded);

  try {
    await session.start({
      room,
      agent: voice.Agent.create({ instructions: options.instructions }),
      inputOptions: {
        participantIdentity: options.callerId,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: {
        audioEnabled: true,
        transcriptionEnabled: false,
      },
      // Flow promises that Huddles are not recorded. Keep LiveKit Agents'
      // optional audio, trace, log, and transcript upload disabled as well.
      record: false,
    });
    session.say(`Hey ${options.callerName}, I’m here.`, {
      allowInterruptions: true,
      addToChatCtx: true,
    });
    limitTimer = setTimeout(() => {
      options.log(`ending huddle after ${options.config.maxSessionMinutes} minute limit`);
      void session.close();
    }, options.config.maxSessionMinutes * 60_000);
    limitTimer.unref();
  } catch (error) {
    if (limitTimer) clearTimeout(limitTimer);
    await session.close().catch(() => undefined);
    await room.disconnect().catch(() => undefined);
    throw error;
  }

  return {
    close: async () => {
      if (closing) return;
      closing = true;
      if (limitTimer) clearTimeout(limitTimer);
      await session.close().catch((error: unknown) => options.log(`agent session close failed: ${errorText(error)}`));
      if (room.isConnected) {
        await room.disconnect().catch((error: unknown) => options.log(`LiveKit disconnect failed: ${errorText(error)}`));
      }
    },
  };
}

/** Connect to LiveKit Inference without ever holding the project API secret. */
export function connectInferenceWebSocket(
  baseUrl: string,
  path: '/stt' | '/tts',
  token: string,
  timeout: number,
  session: Record<string, unknown>,
): Promise<WebSocket> {
  const websocketUrl = `${baseUrl.replace(/^http/, 'ws')}${path}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl, { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error(`LiveKit inference ${path.slice(1)} connection timed out`));
    }, timeout);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('open', onOpen);
      socket.off('error', onError);
    };
    const onOpen = (): void => {
      cleanup();
      try {
        socket.send(JSON.stringify(session));
        resolve(socket);
      } catch (error) {
        socket.terminate();
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
