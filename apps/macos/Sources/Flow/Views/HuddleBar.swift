import LiveKit
import SwiftUI

/// Persistent huddle bar — rendered outside ChannelView, at the MainView
/// level, so it stays up while navigating away from the huddle's channel
/// (CONTEXT.md: Huddle; decision log 2026-08-20 on why the connection lives at
/// the app level). The ✕ actually leaves the huddle rather than just hiding
/// the bar — a hidden-but-still-broadcasting state would contradict the
/// ambient drop-in/drop-out model.
///
/// The bar is the *audio-only* face of a huddle and stays exactly as thin as
/// it was (#435). Video lives in `HuddleGridView` below it, which appears only
/// once somebody turns a camera or a share on.
struct HuddleBar: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @State private var userNames: [String: String] = [:]
    @State private var shareSources: [MacOSScreenCaptureSource] = []
    @State private var pickingSource = false

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
                        Text("Huddle in \(label)")
                            .flowFont(size: 12, weight: .semibold)
                    }
                    .foregroundStyle(MC.ink)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                // The caller waits in the room while it rings (#436).
                if app.outgoingHuddleInvite != nil {
                    Text("Ringing…")
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                        .accessibilityIdentifier("huddle.ringing")
                }
                if !app.huddleUnavailable.isEmpty {
                    Text(unavailableText)
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                        .accessibilityIdentifier("huddle.unavailable")
                }

                Button {
                    app.toggleHuddleMute()
                } label: {
                    Text(app.huddleMuted ? "🔇 Muted" : "🎤 Live")
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                }
                .buttonStyle(.plain)
                .help(app.huddleMuted ? "Unmute" : "Mute")

                Button {
                    app.toggleHuddleCamera()
                } label: {
                    Image(systemName: app.huddleCameraOn ? "video.fill" : "video.slash")
                        .flowFont(size: 11)
                        .foregroundStyle(MC.muted)
                }
                .buttonStyle(.plain)
                .help(app.huddleCameraOn ? "Turn camera off" : "Turn camera on")
                .accessibilityIdentifier("huddle.camera")

                Button {
                    if app.huddleSharing {
                        app.toggleHuddleScreenShare()
                    } else {
                        // Pick a window or a whole display first — macOS can
                        // share either, and "share what?" is a real question
                        // rather than an implied "the main screen".
                        Task {
                            shareSources = await app.screenShareSources()
                            // ScreenCaptureKit returns an *empty list*, not an
                            // error, when Screen Recording was never granted —
                            // so nothing to pick is the permission path.
                            if shareSources.isEmpty {
                                app.screenPermissionBlocked = true
                            } else {
                                pickingSource = true
                            }
                        }
                    }
                } label: {
                    Image(systemName: app.huddleSharing ? "rectangle.inset.filled.on.rectangle" : "rectangle.on.rectangle")
                        .flowFont(size: 11)
                        .foregroundStyle(app.huddleSharing ? MC.accent : MC.muted)
                }
                .buttonStyle(.plain)
                .help(app.huddleSharing ? "Stop sharing" : "Share a window or screen")
                .accessibilityIdentifier("huddle.share")
                .popover(isPresented: $pickingSource) {
                    sourcePicker
                }

                Spacer()

                Button {
                    if app.outgoingHuddleInvite != nil {
                        app.cancelHuddleRing()
                    } else {
                        app.leaveHuddle()
                    }
                } label: {
                    Image(systemName: "xmark")
                        .flowFont(size: 11)
                        .foregroundStyle(MC.faint)
                }
                .buttonStyle(.plain)
                .help(app.outgoingHuddleInvite != nil ? "Cancel" : "Leave huddle")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(MC.accent.opacity(0.1))
            .task(id: channelId) {
                channel.start(db: app.db, reset: nil) { db in
                    try Channel.fetchOne(db, key: channelId)
                }
                userNames = (try? await app.db.reader.read { db in
                    try Dictionary(uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) })
                }) ?? [:]
            }
            .accessibilityIdentifier("huddle.bar")
        }
    }

    /// `#name` for a channel; a DM has no `name`, so it names who it's with —
    /// the same rule the sidebar and thread headers use.
    private var label: String {
        guard let c = channel.value else { return "…" }
        if !c.isDM { return "#\(c.name ?? "")" }
        return c.displayTitle(userNames: userNames, currentUserId: app.currentUser?.id)
    }

    private var unavailableText: String {
        let names = app.huddleUnavailable
        return names.count == 1 ? "\(names[0]) isn't available" : "\(names.joined(separator: ", ")) aren't available"
    }

    private var sourcePicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(shareSources.enumerated()), id: \.offset) { _, source in
                    Button {
                        pickingSource = false
                        app.toggleHuddleScreenShare(source: source)
                    } label: {
                        Text(sourceLabel(source))
                            .flowFont(size: 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 3)
                    .padding(.horizontal, 8)
                }
            }
            .padding(.vertical, 6)
        }
        .frame(width: 300, height: 320)
    }

    private func sourceLabel(_ source: MacOSScreenCaptureSource) -> String {
        if let window = source as? MacOSWindow {
            let app = window.owningApplication?.applicationName ?? "Window"
            return window.title.map { "\(app) — \($0)" } ?? app
        }
        if let display = source as? MacOSDisplay {
            return "Screen (\(display.width)×\(display.height))"
        }
        return "Screen"
    }
}
