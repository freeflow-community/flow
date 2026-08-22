// Persistent voice-huddle bar (Phase 1) — same placement/dismiss principle as
// OpenInAppBanner, but the ✕ has a real side effect: it leaves the huddle
// (decision log 2026-08-20), it doesn't just hide the bar. Rendered at the
// Main.tsx level, outside ChannelView, so it stays up while navigating away
// from the huddle's channel.
import { useHuddle } from '../huddle';
import { useSelection } from '../state';
import { useChannels } from '../hooks';

export default function HuddleMiniBar() {
  const huddle = useHuddle();
  const sel = useSelection();
  const channels = useChannels(huddle.workspaceId);
  if (!huddle.channelId) return null;

  const channel = (channels.data ?? []).find((c) => c.id === huddle.channelId);
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
        🎙 Huddle in {channel ? `#${channel.name ?? ''}` : '…'}
      </button>
      <button
        data-testid="huddle-mini-bar-mute"
        title={huddle.muted ? 'Unmute' : 'Mute'}
        className="rounded-md px-2 py-0.5 text-xs font-semibold text-muted hover:bg-daypill/60"
        onClick={() => huddle.toggleMute()}
      >
        {huddle.muted ? '🔇 Muted' : '🎤 Live'}
      </button>
      <button
        data-testid="huddle-mini-bar-leave"
        title="Leave huddle"
        className="ml-2 text-faint hover:text-ink"
        onClick={() => void huddle.leave()}
      >
        ✕
      </button>
    </div>
  );
}
