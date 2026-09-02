import SwiftUI

/// Persistent huddle bar — pinned above the home indicator, outside
/// ChannelScreen, so it stays up while navigating away from the huddle's
/// channel (CONTEXT.md: Huddle; decision log 2026-08-20 on why the connection
/// lives at the app level). The ✕ actually leaves the huddle rather than just
/// hiding the bar — a hidden-but-still-broadcasting state would contradict the
/// ambient drop-in/drop-out model.
///
/// The bar is the *audio-only* face of a huddle (#435); video appears above it
/// in `HuddleGridView` only once somebody turns a camera or share on.
struct HuddleBar: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @State private var userNames: [String: String] = [:]

    var body: some View {
        if let channelId = app.activeHuddleChannelId {
            HStack(spacing: 10) {
                Button {
                    if let workspaceId = app.activeHuddleWorkspaceId {
                        app.selectWorkspace(workspaceId)
                    }
                    app.selectChannel(channelId)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "mic.fill")
                        Text(app.outgoingHuddleInvite != nil ? "Ringing…" : "Huddle in \(label)")
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                    }
                    .foregroundStyle(MC.ink)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(app.outgoingHuddleInvite != nil ? "huddle.ringing" : "huddle.open")

                Button {
                    app.toggleHuddleMute()
                } label: {
                    Image(systemName: app.huddleMuted ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(MC.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(app.huddleMuted ? "Unmute" : "Mute")

                Button {
                    app.toggleHuddleCamera()
                } label: {
                    Image(systemName: app.huddleCameraOn ? "video.fill" : "video.slash")
                        .font(.system(size: 13))
                        .foregroundStyle(MC.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(app.huddleCameraOn ? "Turn camera off" : "Turn camera on")
                .accessibilityIdentifier("huddle.camera")

                // iOS shares Flow's own content only — a full-screen share
                // needs a Broadcast Upload Extension, deferred by #435.
                // Viewing someone else's share is unrestricted.
                Button {
                    app.toggleHuddleScreenShare()
                } label: {
                    Image(systemName: app.huddleSharing ? "rectangle.inset.filled.on.rectangle" : "rectangle.on.rectangle")
                        .font(.system(size: 13))
                        .foregroundStyle(app.huddleSharing ? MC.accent : MC.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(app.huddleSharing ? "Stop sharing" : "Share Flow's screen")
                .accessibilityIdentifier("huddle.share")

                Spacer()

                Button {
                    if app.outgoingHuddleInvite != nil {
                        app.cancelHuddleRing()
                    } else {
                        app.leaveHuddle()
                    }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12))
                        .foregroundStyle(MC.faint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(app.outgoingHuddleInvite != nil ? "Cancel" : "Leave huddle")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(MC.accent.opacity(0.1))
            .overlay(alignment: .top) {
                if !app.huddleUnavailable.isEmpty {
                    Text(unavailableText)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(MC.muted)
                        .padding(.top, 2)
                        .accessibilityIdentifier("huddle.unavailable")
                }
            }
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
}
