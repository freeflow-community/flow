// Voice huddle (Phase 1) client controller: owns the LiveKit `Room`
// connection and local mute state at the app level, so a huddle survives
// navigating between channels (decision log 2026-08-20: "persists in the
// background", the LiveKit Room must live above ChannelView). Mounted once in
// Main.tsx, alongside the WS socket.
//
// The roster (who's in a huddle) is separate from this: it rides the channel
// list cache via `huddle.updated` events (see lib/channelCache.ts's
// applyHuddle), the same way channel.indicator does. This module is only
// concerned with *this client's own* connection.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import { api } from './lib/api';

export interface HuddleState {
  /** Channel id of the huddle this client is connected to, or null. */
  channelId: string | null;
  workspaceId: string | null;
  connecting: boolean;
  /** Muted on join, by decision — the mic is never auto-published. */
  muted: boolean;
  join(channelId: string, workspaceId: string): Promise<void>;
  leave(): Promise<void>;
  toggleMute(): void;
}

const HuddleContext = createContext<HuddleState | null>(null);

export function useHuddle(): HuddleState {
  const v = useContext(HuddleContext);
  if (!v) throw new Error('HuddleContext missing');
  return v;
}

export function HuddleProvider({ children }: { children: React.ReactNode }) {
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(true);

  /** Drop the local Room without telling the server — used both for our own
   * leave (which follows with a REST call) and for a Disconnected event we
   * didn't initiate (e.g. a second tab/device took over our identity — see
   * decision log 2026-08-20 on bare-userId identity). */
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

  const join = useCallback(
    async (newChannelId: string, newWorkspaceId: string) => {
      if (channelId === newChannelId) return; // already in it
      if (channelId) await leave(); // switching huddles: leave the old one first
      setConnecting(true);
      try {
        const { token, url } = await api<{ token: string; url: string }>(
          'POST',
          `/v1/channels/${newChannelId}/huddle/join`,
        );
        const room = new Room();
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
          if (track.kind !== Track.Kind.Audio) return;
          const el = track.attach();
          el.autoplay = true;
          audioContainerRef.current?.appendChild(el);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return;
          for (const el of track.detach()) el.remove();
        });
        room.on(RoomEvent.Disconnected, () => teardown());
        try {
          await room.connect(url, token);
        } catch (err) {
          // The REST join already landed server-side (it publishes on
          // roster change), but the RTC connection never came up — without
          // this, the roster would show a participant who was never
          // actually live. Roll it back.
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
      } finally {
        setConnecting(false);
      }
    },
    [channelId, leave, teardown],
  );

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    void room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const value = useMemo<HuddleState>(
    () => ({ channelId, workspaceId, connecting, muted, join, leave, toggleMute }),
    [channelId, workspaceId, connecting, muted, join, leave, toggleMute],
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
