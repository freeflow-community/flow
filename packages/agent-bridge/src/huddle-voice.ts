import type { HuddleInviteData, HuddleJoinDTO, HuddleUpdatedData, MessageDTO } from '@flow/shared';
import type { VoiceConfig } from './config.js';

const TERMINAL_INVITE_STATES = new Set(['ended', 'declined', 'missed', 'cancelled']);
const MAX_HANDOFF_LENGTH = 4000;
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
  apiKey: string;
  config: VoiceConfig;
  handoff(request: string): Promise<string>;
  onEnded(): void;
  log(message: string): void;
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
  /** Runtime secrets stay in the daemon environment, never agent.json. */
  apiKey?: string | undefined;
  callerName(userId: string): string;
  isOneToOneDm(channelId: string): Promise<boolean>;
  buildInstructions(channelId: string, callerId: string): Promise<string>;
  handoff(channelId: string, callerId: string, request: string): Promise<string>;
  log(message: string): void;
  sessionFactory?: LiveVoiceSessionFactory | undefined;
}

/**
 * Turns the existing DM ring into a real bot call. The server remains the
 * source of truth for invite and roster state; this class just performs the
 * same accept / join / leave operations as a human client, then attaches a
 * realtime audio participant to the minted LiveKit room token.
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

    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      await this.declineWithMessage(
        invite.id,
        invite.channelId,
        `📞 I can’t answer voice yet because my bridge is missing \`OPENAI_API_KEY\`. Add it to the bridge environment, restart me, and call again.`,
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
      let endedDuringStart = false;
      const session = await this.sessionFactory({
        url: room.url,
        token: room.token,
        callerId: invite.startedBy,
        callerName: this.options.callerName(invite.startedBy),
        agentName: this.options.agentName,
        instructions,
        apiKey,
        config: this.options.config,
        handoff: async (request) => {
          const clean = request.trim().slice(0, MAX_HANDOFF_LENGTH);
          if (!clean) return 'Nothing was queued because the request was empty.';
          return this.options.handoff(invite.channelId, invite.startedBy, clean);
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
 * bridge can start without loading LiveKit's native RTC binding, and unit
 * tests exercise the call state machine without a room or API key.
 */
export async function createLiveKitVoiceSession(options: LiveVoiceSessionOptions): Promise<LiveVoiceSession> {
  const [{ Room, RoomEvent }, agents, openai] = await Promise.all([
    import('@livekit/rtc-node'),
    import('@livekit/agents'),
    import('@livekit/agents-plugin-openai'),
  ]);
  const { llm, voice } = agents;
  // Worker-based LiveKit apps get this from cli.runApp(). The bridge embeds an
  // AgentSession directly, so it must initialize the framework logger itself.
  if (!liveKitLoggerInitialized) {
    agents.initializeLogger({ pretty: false, level: 'warn' });
    liveKitLoggerInitialized = true;
  }
  const room = new Room();
  let closing = false;
  let ended = false;
  const emitEnded = (): void => {
    if (ended) return;
    ended = true;
    options.onEnded();
  };

  await room.connect(options.url, options.token, { autoSubscribe: true, dynacast: true });
  room.on(RoomEvent.Disconnected, emitEnded);

  const model = new openai.realtime.RealtimeModel({
    apiKey: options.apiKey,
    model: options.config.model,
    voice: options.config.voice,
    maxSessionDuration: options.config.maxSessionMinutes * 60_000,
    turnDetection: {
      type: 'semantic_vad',
      eagerness: 'auto',
      create_response: true,
      interrupt_response: true,
    },
  });
  const handoffTool = llm.tool({
    name: 'handoff_to_chat',
    description:
      'Queue substantial work in the normal Flow chat agent after the caller explicitly asks you to do it. ' +
      'Use this for code changes, repository work, research, or anything requiring tools. Ask for missing details first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_HANDOFF_LENGTH,
          description: 'A self-contained task request preserving the caller’s constraints and decisions from this call.',
        },
      },
      required: ['request'],
    },
    execute: async (args: { request: string }) => options.handoff(args.request),
  });
  const session = new voice.AgentSession({
    llm: model,
    vad: null,
    userAwayTimeout: null,
    turnHandling: { turnDetection: 'realtime_llm' },
  });
  session.on(voice.AgentSessionEventTypes.Error, (event) => {
    options.log(`realtime voice error: ${errorText(event.error)}`);
  });
  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
    if (event.isFinal && event.transcript.trim()) options.log('heard final voice turn');
  });
  session.on(voice.AgentSessionEventTypes.Close, emitEnded);

  try {
    await session.start({
      room,
      agent: voice.Agent.create({
        instructions: options.instructions,
        tools: [handoffTool],
      }),
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
    session.generateReply({
      instructions:
        `Greet ${options.callerName} by name in one short, natural sentence. ` +
        `You just answered their Flow Huddle, so sound like you picked up a call rather than starting a demo.`,
      allowInterruptions: true,
    });
  } catch (error) {
    await session.close().catch(() => undefined);
    await room.disconnect().catch(() => undefined);
    throw error;
  }

  return {
    close: async () => {
      if (closing) return;
      closing = true;
      await session.close().catch((error: unknown) => options.log(`agent session close failed: ${errorText(error)}`));
      if (room.isConnected) {
        await room.disconnect().catch((error: unknown) => options.log(`LiveKit disconnect failed: ${errorText(error)}`));
      }
    },
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
