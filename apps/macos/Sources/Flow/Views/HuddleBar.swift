import SwiftUI

/// Persistent voice-huddle bar (Phase 1) — rendered outside ChannelView, at
/// the MainView level, so it stays up while navigating away from the
/// huddle's channel (CONTEXT.md: Huddle; decision log 2026-08-20 on why the
/// connection lives at the app level). The ✕ actually leaves the huddle
/// rather than just hiding the bar — a hidden-but-still-broadcasting state
/// would contradict the ambient drop-in/drop-out model.
struct HuddleBar: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)

    var body: some View {
        if let channelId = app.activeHuddleChannelId {
            HStack(spacing: 10) {
                Button {
                    if let workspaceId = app.activeHuddleWorkspaceId {
                        win.selectWorkspace(workspaceId)
                    }
                    win.selectChannel(channelId)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "mic.fill")
                        Text("Huddle in #\(channel.value?.name ?? "…")")
                            .flowFont(size: 12, weight: .semibold)
                    }
                    .foregroundStyle(MC.ink)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Button {
                    app.toggleHuddleMute()
                } label: {
                    Text(app.huddleMuted ? "🔇 Muted" : "🎤 Live")
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                }
                .buttonStyle(.plain)
                .help(app.huddleMuted ? "Unmute" : "Mute")

                Spacer()

                Button {
                    app.leaveHuddle()
                } label: {
                    Image(systemName: "xmark")
                        .flowFont(size: 11)
                        .foregroundStyle(MC.faint)
                }
                .buttonStyle(.plain)
                .help("Leave huddle")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(MC.accent.opacity(0.1))
            .task(id: channelId) {
                channel.start(db: app.db, reset: nil) { db in
                    try Channel.fetchOne(db, key: channelId)
                }
            }
            .accessibilityIdentifier("huddle.bar")
        }
    }
}
