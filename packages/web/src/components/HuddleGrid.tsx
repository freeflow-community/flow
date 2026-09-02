// The huddle's video surface (#435). The thin bar (HuddleMiniBar) is what an
// audio-only huddle looks like; this is what it becomes the moment anyone
// turns on a camera or starts sharing, and it collapses back when the last one
// stops. Nothing here is mounted unless there is video to show — an audio
// huddle costs exactly what it did before.
//
// Two layouts, one rule: a live screen share gets the room (big tile, people
// reduced to a filmstrip beside it), because that is what everyone is looking
// at. Otherwise every tile is equal. Tapping a tile focuses it, which is the
// same layout with a different subject.
import { useEffect, useRef } from 'react';
import type { TrackPublication } from 'livekit-client';
import { useHuddle, type HuddleTile } from '../huddle';
import { useMembers } from '../hooks';
import { Avatar } from './Avatar';

/** Attach a LiveKit video track to a real <video>, and detach on the way out.
 * The element is owned by React, the track by LiveKit, so this is the seam. */
function VideoSurface({
  publication,
  mirror,
  fit = false,
}: {
  publication: TrackPublication;
  mirror: boolean;
  /** Letterbox rather than crop — right for a screen share, where cropping
   * would cut off the edges of what someone is trying to show you. */
  fit?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const track = publication.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      // Your own preview is muted (you'd hear yourself) and mirrored, which is
      // what people expect of a self-view and only of a self-view.
      muted={mirror}
      className={`h-full w-full ${fit ? 'object-contain' : 'object-cover'}`}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

function Tile({
  tile,
  name,
  avatarUrl,
  big,
  onFocus,
}: {
  tile: HuddleTile;
  name: string;
  avatarUrl: string | null;
  big: boolean;
  onFocus(): void;
}) {
  const camera = tile.camera?.isSubscribed || tile.isLocal ? tile.camera : null;
  const showVideo = camera?.track && !camera.isMuted;
  return (
    <button
      type="button"
      data-testid={`huddle-tile-${tile.userId}`}
      onClick={onFocus}
      className={`relative overflow-hidden rounded-lg bg-black/60 ${
        big ? 'aspect-video w-full' : 'aspect-video'
      } ${tile.speaking ? 'ring-2 ring-accent' : 'ring-1 ring-hairline'}`}
    >
      {showVideo ? (
        <VideoSurface publication={camera!} mirror={tile.isLocal} />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Avatar userId={tile.userId} name={name} avatarUrl={avatarUrl} size={big ? 96 : 44} radius={999} />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] font-semibold text-white">
        {/* Per-tile badges: mic and camera state, so the grid answers "can
            they hear me / can I see them" without anyone having to ask. */}
        <span title={tile.micOn ? 'Mic on' : 'Muted'}>{tile.micOn ? '🎤' : '🔇'}</span>
        {showVideo && <span title="Camera on">📹</span>}
        <span className="truncate">
          {name}
          {tile.isLocal ? ' (you)' : ''}
        </span>
      </span>
    </button>
  );
}

export default function HuddleGrid() {
  const huddle = useHuddle();
  const members = useMembers(huddle.workspaceId);
  const byId = new Map((members.data ?? []).map((m) => [m.userId, m]));
  const nameOf = (userId: string): string => byId.get(userId)?.displayName ?? 'Someone';
  const avatarOf = (userId: string): string | null => byId.get(userId)?.avatarUrl ?? null;

  if (!huddle.channelId || !huddle.hasVideo) return null;

  const sharer = huddle.screenSharerId ? huddle.tiles.find((t) => t.userId === huddle.screenSharerId) : undefined;
  const share = sharer?.screen;
  const focused = huddle.focusedUserId ? huddle.tiles.find((t) => t.userId === huddle.focusedUserId) : undefined;

  return (
    // Capped at 40% of the viewport: the huddle is something you have *while*
    // working in the conversation, so it must never push the transcript and
    // composer off screen — an uncapped 16:9 share tile did exactly that.
    <div
      data-testid="huddle-grid"
      className="flex max-h-[40vh] shrink-0 flex-col overflow-hidden border-b border-hairline bg-daypill/40 p-3"
    >
      {huddle.notice && (
        <div data-testid="huddle-notice" className="mb-2 text-center text-xs font-semibold text-muted">
          {huddle.notice}
        </div>
      )}
      {share?.track ? (
        // A share takes the room; everyone else becomes a filmstrip down the side.
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-black">
            <div className="min-h-0 flex-1">
              <VideoSurface publication={share} mirror={false} fit />
            </div>
            <div className="px-2 py-1 text-[11px] font-semibold text-white/80">
              {nameOf(sharer!.userId)} is sharing
            </div>
          </div>
          <div
            data-testid="huddle-filmstrip"
            className="flex w-[140px] shrink-0 flex-col gap-2 overflow-y-auto"
          >
            {huddle.tiles.map((t) => (
              <Tile
                key={t.userId}
                tile={t}
                name={nameOf(t.userId)}
                avatarUrl={avatarOf(t.userId)}
                big={false}
                onFocus={() => huddle.focus(huddle.focusedUserId === t.userId ? null : t.userId)}
              />
            ))}
          </div>
        </div>
      ) : focused ? (
        // Tap-to-focus: one tile blown up, the rest along the bottom.
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <Tile
            tile={focused}
            name={nameOf(focused.userId)}
            avatarUrl={avatarOf(focused.userId)}
            big
            onFocus={() => huddle.focus(null)}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {huddle.tiles
              .filter((t) => t.userId !== focused.userId)
              .map((t) => (
                <Tile
                  key={t.userId}
                  tile={t}
                  name={nameOf(t.userId)}
                  avatarUrl={avatarOf(t.userId)}
                  big={false}
                  onFocus={() => huddle.focus(t.userId)}
                />
              ))}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 overflow-y-auto">
          {huddle.tiles.map((t) => (
            <Tile
              key={t.userId}
              tile={t}
              name={nameOf(t.userId)}
              avatarUrl={avatarOf(t.userId)}
              big={false}
              onFocus={() => huddle.focus(t.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
