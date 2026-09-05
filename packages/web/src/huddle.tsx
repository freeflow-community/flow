// Huddle client controller: owns the LiveKit `Room` connection, the local
// publish state (mic / camera / screen share) and the DM ring, at the app
// level — so a huddle survives navigating between channels (decision log
// 2026-08-20: "persists in the background", the LiveKit Room must live above
// ChannelView). Mounted once in Main.tsx, alongside the WS socket.
//
// Two things ride here that the roster does not: the *media* state that drives
// the tile grid (#435) and the *ring* state that drives the incoming-call
// overlay (#436). The roster (who's in a huddle at all) is separate and rides
// the channel-list cache via `huddle.updated` events, the same way
// channel.indicator does — see lib/channelCache.ts's applyHuddle.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  LocalTrackPublication,
  Participant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type RemoteTrack,
  type RemoteParticipant,
  type TrackPublication,
} from 'livekit-client';
import type { HuddleInviteDTO, HuddleJoinDTO } from '@flow/shared';
import { api } from './lib/api';
import { useMembers } from './hooks';
import { playConnectChime } from './lib/connectChime';
import { huddleConnection, shouldChime, type HuddleConnection, type HuddlePeerState } from './lib/huddleConnection';
import { ringEffect } from './lib/huddleRing';

/** One person in the huddle, as the grid draws them. */
export interface HuddleTile {
  userId: string;
  isLocal: boolean;
  /** Their camera, if they have one on. */
  camera: TrackPublication | null;
  /** Their screen share, if they are the one sharing. */
  screen: TrackPublication | null;
  micOn: boolean;
  speaking: boolean;
  /** They have an audio track published to the room — muted or not. The mic
   * badge answers "are they talking"; this answers "is there a voice path at
   * all", which is what a silent agent gets wrong (#508). */
  audioLive: boolean;
}

export interface HuddleState {
  /** Entity id (channel or DM) of the huddle this client is connected to, or null. */
  channelId: string | null;
  workspaceId: string | null;
  connecting: boolean;
  /** Muted on join, by decision — the mic is never auto-published. */
  muted: boolean;
  /** Camera off on join, likewise. */
  cameraOn: boolean;
  sharing: boolean;
  tiles: HuddleTile[];
  /** Whoever is currently sharing a screen — at most one (see startScreenShare). */
  screenSharerId: string | null;
  /** True once anyone turns on a camera or a share: the bar becomes a grid. */
  hasVideo: boolean;
  /** Tap-to-focus: the tile blown up, or null for the even grid. */
  focusedUserId: string | null;
  focus(userId: string | null): void;
  /** Transient one-liner over the huddle UI ("Ada started sharing"). */
  notice: string | null;
  /** Whether the other side is actually here yet (#508). */
  connection: HuddleConnection;

  // ---- DM ring (#436) ----
  /** A ring aimed at us, if one is live. Drives the incoming-call overlay. */
  incoming: HuddleInviteDTO | null;
  /** Our own outgoing ring while we wait for an answer. */
  outgoing: HuddleInviteDTO | null;
  /** Names we could not reach — the "X isn't available" line. */
  unavailable: string[];
  /** Set when another of our devices answered, so this one can say so. */
  answeredElsewhere: boolean;
  dismissAnsweredElsewhere(): void;

  join(channelId: string, workspaceId: string): Promise<void>;
  leave(): Promise<void>;
  toggleMute(): void;
  toggleCamera(): Promise<void>;
  toggleScreenShare(): Promise<void>;
  acceptIncoming(): Promise<void>;
  declineIncoming(): Promise<void>;
  /** Give up on an outgoing ring nobody has answered yet. */
  cancelOutgoing(): Promise<void>;
  /** Main.tsx feeds `huddle.invite` events in here. */
  applyInviteEvent(invite: HuddleInviteDTO, meta: { selfId: string; answeredBySessionId?: string; unavailable?: string[] }): void;
  /** Main.tsx hands over the WS session id from the `hello` frame. */
  setSessionId(sessionId: string | null): void;
}

const HuddleContext = createContext<HuddleState | null>(null);

export function useHuddle(): HuddleState {
  const v = useContext(HuddleContext);
  if (!v) throw new Error('HuddleContext missing');
  return v;
}

/**
 * Publish settings, all four acceptance criteria in one object (#435):
 * camera capped at 360p and screen share at 720p/15fps to protect LiveKit
 * free-tier bandwidth; adaptive stream so a tile nobody can see stops being
 * sent at all; dynacast so simulcast layers nobody subscribes to stop being
 * encoded. The caps are on *capture* as well as encoding — a 1080p webcam
 * downscaled at the encoder still costs the whole capture pipeline.
 */
function newRoom(): Room {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
    publishDefaults: {
      videoEncoding: VideoPresets.h360.encoding,
      // Two layers, both at or under the cap — the point of the cap is that
      // there is no 720p layer to fall back up to.
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      screenShareEncoding: ScreenSharePresets.h720fps15.encoding,
    },
  });
}

const NOTICE_MS = 4000;

export function HuddleProvider({ children }: { children: React.ReactNode }) {
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [tiles, setTiles] = useState<HuddleTile[]>([]);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<HuddleInviteDTO | null>(null);
  const [outgoing, setOutgoing] = useState<HuddleInviteDTO | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [answeredElsewhere, setAnsweredElsewhere] = useState(false);
  /** Invite targets that have said yes. They are on their way into the room
   * but LiveKit has not seen them yet — the "Connecting…" case #508 names. */
  const [accepted, setAccepted] = useState<string[]>([]);
  /** One chime per call establishment (#509), never per reconnect. Cleared
   * only when the call ends, so a track resubscribing can't ring it again. */
  const chimed = useRef(false);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  /** Rebuild the tile list from the Room's own state — one place, so every
   * track/mute/speaker event converges on the same shape rather than each
   * trying to patch a slice of it. */
  const syncTiles = useCallback(() => {
    const room = roomRef.current;
    if (!room) return setTiles([]);
    /**
     * A publication only counts as *showing video* when it carries a live,
     * unmuted track we can actually render. Turning a camera off does not
     * unpublish it — LiveKit mutes the publication and keeps it — so a plain
     * "is there a publication?" test stays true forever after the first
     * camera-on, and the grid would never collapse back to the bar.
     */
    const showing = (p: Participant, source: Track.Source, isLocal: boolean): TrackPublication | null => {
      const pub = p.getTrackPublication(source);
      if (!pub || pub.isMuted || !pub.track) return null;
      // A remote track we haven't subscribed to has nothing to draw yet.
      return isLocal || pub.isSubscribed ? pub : null;
    };
    /**
     * Is their voice path up? Unlike video, a *muted* mic publication still
     * counts — LiveKit keeps the publication across a mute, and someone who
     * unmutes mid-call was connected all along. What this rules out is the
     * case #508 is about: a participant in the room that has published no
     * audio at all.
     */
    const audioLive = (p: Participant, isLocal: boolean): boolean => {
      const pub = p.getTrackPublication(Track.Source.Microphone);
      if (!pub) return false;
      return isLocal ? pub.track != null : pub.isSubscribed && pub.track != null;
    };
    const build = (p: Participant, isLocal: boolean): HuddleTile => ({
      userId: p.identity,
      isLocal,
      camera: showing(p, Track.Source.Camera, isLocal),
      screen: showing(p, Track.Source.ScreenShare, isLocal),
      micOn: p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      audioLive: audioLive(p, isLocal),
    });
    const next = [
      build(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => build(p, false)),
    ];
    setTiles(next);
    setCameraOn(room.localParticipant.isCameraEnabled);
    setSharing(room.localParticipant.isScreenShareEnabled);
  }, []);

  const teardown = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      void room.disconnect();
    }
    setChannelId(null);
    setWorkspaceId(null);
    setMuted(true);
    setCameraOn(false);
    setSharing(false);
    setTiles([]);
    setFocusedUserId(null);
    setOutgoing(null);
    setUnavailable([]);
    setAccepted([]);
    chimed.current = false;
  }, []);

  const leave = useCallback(async () => {
    const leavingChannelId = channelId;
    teardown();
    if (leavingChannelId) {
      // Best-effort: the webhook safety net (participant_left) covers this
      // even if the request never lands.
      try {
        await api('POST', `/v1/channels/${leavingChannelId}/huddle/leave`);
      } catch {
        /* reconciliation safety net covers it */
      }
    }
  }, [channelId, teardown]);

  /** Connect to a room from a token the server already minted. Shared by the
   * ordinary join and by answering a ring — accepting a call is joining, and
   * the only difference is which endpoint produced the token. */
  const connect = useCallback(
    async (newChannelId: string, newWorkspaceId: string, res: HuddleJoinDTO) => {
      const room = newRoom();
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          audioContainerRef.current?.appendChild(el);
        }
        if (pub.source === Track.Source.ScreenShare) {
          flash(`${p.name || 'Someone'} started sharing`);
          setFocusedUserId(p.identity);
          // One share at a time (#435): the newest wins, so ours stops.
          if (room.localParticipant.isScreenShareEnabled) {
            void room.localParticipant.setScreenShareEnabled(false);
          }
        }
        syncTiles();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) for (const el of track.detach()) el.remove();
        if (pub.source === Track.Source.ScreenShare) {
          setFocusedUserId((cur) => (cur === p.identity ? null : cur));
        }
        syncTiles();
      });
      room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
        if (pub.source === Track.Source.ScreenShare) setFocusedUserId(room.localParticipant.identity);
        syncTiles();
      });
      room.on(RoomEvent.LocalTrackUnpublished, syncTiles);
      room.on(RoomEvent.ParticipantConnected, syncTiles);
      room.on(RoomEvent.ParticipantDisconnected, syncTiles);
      room.on(RoomEvent.TrackMuted, syncTiles);
      room.on(RoomEvent.TrackUnmuted, syncTiles);
      room.on(RoomEvent.ActiveSpeakersChanged, syncTiles);
      room.on(RoomEvent.Disconnected, () => teardown());
      try {
        await room.connect(res.url, res.token);
      } catch (err) {
        // The REST join already landed server-side (it publishes on roster
        // change), but the RTC connection never came up — without this, the
        // roster would show a participant who was never actually live. Roll
        // it back.
        room.removeAllListeners();
        try {
          await api('POST', `/v1/channels/${newChannelId}/huddle/leave`);
        } catch {
          /* reconciliation safety net covers it */
        }
        throw err;
      }
      roomRef.current = room;
      setChannelId(newChannelId);
      setWorkspaceId(newWorkspaceId);
      setMuted(true);
      setCameraOn(false);
      setSharing(false);
      syncTiles();
    },
    [flash, syncTiles, teardown],
  );

  const join = useCallback(
    async (newChannelId: string, newWorkspaceId: string) => {
      if (channelId === newChannelId) return; // already in it
      if (channelId) await leave(); // switching huddles: leave the old one first
      setConnecting(true);
      setUnavailable([]);
      setAccepted([]);
      chimed.current = false;
      try {
        const res = await api<HuddleJoinDTO>('POST', `/v1/channels/${newChannelId}/huddle/join`);
        await connect(newChannelId, newWorkspaceId, res);
        // In a DM the join *is* the call: hold the ring state so the bar can
        // say "Ringing…", or say who could not be reached.
        if (res.invite && res.invite.status === 'ringing') setOutgoing(res.invite);
        if (res.unavailable.length > 0) setUnavailable(res.unavailable);
      } finally {
        setConnecting(false);
      }
    },
    [channelId, connect, leave],
  );

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    // Only flip the UI once the mic is actually (un)published — a denied
    // permission or a capture failure must not claim live audio that was
    // never actually sent.
    room.localParticipant.setMicrophoneEnabled(!next).then(
      () => {
        setMuted(next);
        syncTiles();
      },
      () => {},
    );
  }, [muted, syncTiles]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(!cameraOn);
    } catch {
      // Denied permission or no device: say so rather than leaving a button
      // that looks toggled and sends nothing.
      flash("Couldn't turn on your camera");
    }
    syncTiles();
  }, [cameraOn, flash, syncTiles]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!sharing, {
        // Best-effort tab audio — Chromium offers it, other browsers ignore
        // the flag and share silently rather than failing (#435).
        audio: true,
        resolution: ScreenSharePresets.h720fps15.resolution,
      });
    } catch {
      // Includes the ordinary case of dismissing the browser's picker.
      flash('Screen sharing was cancelled');
    }
    syncTiles();
  }, [sharing, flash, syncTiles]);

  const acceptIncoming = useCallback(async () => {
    const invite = incoming;
    if (!invite) return;
    setIncoming(null);
    setConnecting(true);
    try {
      if (channelId && channelId !== invite.channelId) await leave();
      const res = await api<HuddleJoinDTO>('POST', `/v1/huddle/invites/${invite.id}/accept`, {
        sessionId: sessionIdRef.current ?? undefined,
      });
      await connect(invite.channelId, invite.workspaceId, res);
    } finally {
      setConnecting(false);
    }
  }, [incoming, channelId, connect, leave]);

  const declineIncoming = useCallback(async () => {
    const invite = incoming;
    if (!invite) return;
    setIncoming(null);
    try {
      await api('POST', `/v1/huddle/invites/${invite.id}/decline`, { sessionId: sessionIdRef.current ?? undefined });
    } catch {
      /* the 30s timeout retires it anyway */
    }
  }, [incoming]);

  const cancelOutgoing = useCallback(async () => {
    const invite = outgoing;
    setOutgoing(null);
    await leave();
    if (invite) {
      try {
        await api('POST', `/v1/huddle/invites/${invite.id}/cancel`);
      } catch {
        /* leaving already emptied the room, which ends it server-side */
      }
    }
  }, [outgoing, leave]);

  /**
   * Fold a `huddle.invite` event into ring state. One event type covers both
   * directions, so the rule is written once here: the overlay is up only while
   * the invite is ringing *and* our own target row still says ringing. That is
   * what dismisses a second device when the first one answers — and when the
   * answer came from a sibling device rather than this one, it says so.
   */
  const applyInviteEvent = useCallback<HuddleState['applyInviteEvent']>((invite, meta) => {
    // Our own ring: remember who said yes. Once a target accepts, the invite
    // stops being "ringing" and the ring state drops it — but the caller is
    // still waiting for that participant to turn up in the room (#508).
    if (invite.startedBy === meta.selfId) {
      setAccepted(invite.targets.filter((t) => t.status === 'accepted').map((t) => t.userId));
    }
    const effect = ringEffect(invite, { ...meta, mySessionId: sessionIdRef.current });
    switch (effect.kind) {
      case 'ring':
        setIncoming(effect.invite);
        break;
      case 'answered-elsewhere':
        setIncoming((cur) => (cur?.id === invite.id ? null : cur));
        setAnsweredElsewhere(true);
        break;
      case 'dismiss':
        setIncoming((cur) => (cur?.id === invite.id ? null : cur));
        break;
      case 'outgoing':
        setOutgoing(effect.invite);
        if (effect.unavailable.length > 0) setUnavailable(effect.unavailable);
        break;
      case 'ignore':
        break;
    }
  }, []);

  const setSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const screenSharerId = tiles.find((t) => t.screen)?.userId ?? null;
  const hasVideo = tiles.some((t) => t.camera || t.screen);

  // Is the other side actually here (#508)? The rule itself lives in
  // lib/huddleConnection so macOS and iOS read the same one; all this does is
  // feed it the room as it stands, plus whoever has accepted but not arrived.
  const members = useMembers(workspaceId);
  const agentIds = useMemo(
    () => new Set((members.data ?? []).filter((m) => m.isAgent).map((m) => m.userId)),
    [members.data],
  );
  const peers = useMemo<HuddlePeerState[]>(
    () =>
      tiles
        .filter((t) => !t.isLocal)
        .map((t) => ({ userId: t.userId, audioLive: t.audioLive, isAgent: agentIds.has(t.userId) })),
    [tiles, agentIds],
  );
  const awaiting = useMemo(() => {
    const inRoom = new Set(peers.map((p) => p.userId));
    return accepted.filter((id) => !inRoom.has(id));
  }, [accepted, peers]);
  const connection = huddleConnection(peers, awaiting);

  // The connect chime (#509) rides the same edge as the badge: one soft tone
  // the moment the call is genuinely up, and none at all for a call that never
  // connects.
  useEffect(() => {
    if (!shouldChime(connection, chimed.current)) return;
    chimed.current = true;
    playConnectChime();
  }, [connection]);

  const value = useMemo<HuddleState>(
    () => ({
      channelId,
      workspaceId,
      connecting,
      muted,
      cameraOn,
      sharing,
      tiles,
      screenSharerId,
      hasVideo,
      focusedUserId,
      focus: setFocusedUserId,
      notice,
      connection,
      incoming,
      outgoing,
      unavailable,
      answeredElsewhere,
      dismissAnsweredElsewhere: () => setAnsweredElsewhere(false),
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      acceptIncoming,
      declineIncoming,
      cancelOutgoing,
      applyInviteEvent,
      setSessionId,
    }),
    [
      channelId, workspaceId, connecting, muted, cameraOn, sharing, tiles, screenSharerId, hasVideo,
      focusedUserId, notice, connection, incoming, outgoing, unavailable, answeredElsewhere, join, leave, toggleMute,
      toggleCamera, toggleScreenShare, acceptIncoming, declineIncoming, cancelOutgoing, applyInviteEvent,
      setSessionId,
    ],
  );

  return (
    <HuddleContext.Provider value={value}>
      {children}
      {/* Remote participants' audio elements. Hidden — this is a sink, not UI.
          Always mounted here (not inside ChannelView) so playback survives
          navigating away from the huddle's channel. */}
      <div ref={audioContainerRef} data-testid="huddle-audio-sinks" style={{ display: 'none' }} />
    </HuddleContext.Provider>
  );
}
