// Persistent huddle bar — same placement/dismiss principle as OpenInAppBanner,
// but the ✕ has a real side effect: it leaves the huddle (decision log
// 2026-08-20), it doesn't just hide the bar. Rendered at the Main.tsx level,
// outside ChannelView, so it stays up while navigating away from the huddle's
// channel.
//
// The bar is the *audio-only* face of a huddle and stays exactly as thin as it
// was (#435). Video lives in HuddleGrid below it, which appears only once
// somebody turns a camera or a share on — so the common case, a voice huddle,
// looks and costs precisely what it did before.
import { useHuddle } from '../huddle';
import { useAuth, useSelection } from '../state';
import { useChannels, useNameMap } from '../hooks';
import { dmTitle } from '../lib/channelTitle';

export default function HuddleMiniBar() {
  const huddle = useHuddle();
  const sel = useSelection();
  const auth = useAuth();
  const channels = useChannels(huddle.workspaceId);
  const names = useNameMap(huddle.workspaceId);
  if (!huddle.channelId) return null;

  const channel = (channels.data ?? []).find((c) => c.id === huddle.channelId);
  // A DM has no name — the title is the other person, same as the sidebar.
  const label = channel
    ? channel.kind === 'standard'
      ? `#${channel.name ?? ''}`
      : dmTitle(channel, names, auth.user.id)
    : '…';
  const goToHuddle = () => {
    if (huddle.workspaceId && huddle.workspaceId !== sel.workspaceId) sel.selectWorkspace(huddle.workspaceId);
    sel.selectChannel(huddle.channelId);
  };

  return (
    <div
      data-testid="huddle-mini-bar"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-hairline bg-accent/10 px-4 py-1.5 text-sm"
    >
      <button
        data-testid="huddle-mini-bar-open"
        className="flex items-center gap-1.5 font-semibold text-ink hover:underline"
        onClick={goToHuddle}
      >
        🎙 Huddle in {label}
      </button>

      {/* Outgoing ring: the caller is already in the room, waiting (#436). */}
      {huddle.outgoing && (
        <span data-testid="huddle-ringing" className="text-xs font-semibold text-muted">
          Ringing…
        </span>
      )}
      {/* Is the other side actually here (#508)? Nothing while you're alone in
          a channel huddle — this is call feedback, not a diagnostics panel. */}
      {huddle.connection !== 'idle' && (
        <span
          data-testid="huddle-connection"
          data-state={huddle.connection}
          title={
            huddle.connection === 'connected'
              ? 'Connected — their audio is live'
              : 'Connecting — waiting for their audio'
          }
          className="flex items-center gap-1.5 text-xs font-semibold text-muted"
        >
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
              huddle.connection === 'connected' ? 'bg-online' : 'animate-pulse bg-faint'
            }`}
          />
          {huddle.connection === 'connected' ? 'Connected' : 'Connecting…'}
        </span>
      )}
      {huddle.unavailable.length > 0 && (
        <span data-testid="huddle-unavailable" className="text-xs font-semibold text-muted">
          {huddle.unavailable.join(', ')} {huddle.unavailable.length === 1 ? "isn't" : "aren't"} available
        </span>
      )}

      <button
        data-testid="huddle-mini-bar-mute"
        title={huddle.muted ? 'Unmute' : 'Mute'}
        className="rounded-md px-2 py-0.5 text-xs font-semibold text-muted hover:bg-daypill/60"
        onClick={() => huddle.toggleMute()}
      >
        {huddle.muted ? '🔇 Muted' : '🎤 Live'}
      </button>
      <button
        data-testid="huddle-mini-bar-camera"
        title={huddle.cameraOn ? 'Turn camera off' : 'Turn camera on'}
        className="rounded-md px-2 py-0.5 text-xs font-semibold text-muted hover:bg-daypill/60"
        onClick={() => void huddle.toggleCamera()}
      >
        {huddle.cameraOn ? '📹 On' : '📷 Off'}
      </button>
      <button
        data-testid="huddle-mini-bar-share"
        title={huddle.sharing ? 'Stop sharing' : 'Share your screen'}
        className="rounded-md px-2 py-0.5 text-xs font-semibold text-muted hover:bg-daypill/60"
        onClick={() => void huddle.toggleScreenShare()}
      >
        {huddle.sharing ? '🖥 Sharing' : '🖥 Share'}
      </button>

      <button
        data-testid="huddle-mini-bar-leave"
        title={huddle.outgoing ? 'Cancel' : 'Leave huddle'}
        className="ml-2 text-faint hover:text-ink"
        onClick={() => void (huddle.outgoing ? huddle.cancelOutgoing() : huddle.leave())}
      >
        ✕
      </button>
    </div>
  );
}
