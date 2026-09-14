import LiveKit
import SwiftUI

/// The huddle's video surface (#435). `HuddleBar` is what an audio-only huddle
/// looks like; this is what it becomes the moment anyone turns on a camera or
/// starts sharing, and it collapses back when the last one stops. Nothing here
/// is mounted unless there is video to show — an audio huddle costs exactly
/// what it did before.
///
/// Two layouts, one rule: a live screen share gets the room (big tile, people
/// reduced to a filmstrip beside it), because that is what everyone is looking
/// at. Otherwise every tile is equal. Clicking a tile focuses it, which is the
/// same layout with a different subject.
struct HuddleGridView: View {
    @EnvironmentObject private var app: AppState
    @State private var userNames: [String: String] = [:]

    var body: some View {
        if app.activeHuddleChannelId != nil, app.huddleHasVideo {
            VStack(spacing: 8) {
                if let notice = app.huddleNotice {
                    Text(notice)
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                        .accessibilityIdentifier("huddle.notice")
                }
                content
            }
            .padding(10)
            .background(MC.daypill.opacity(0.5))
            .frame(maxHeight: 320)
            .task(id: app.activeHuddleChannelId) {
                userNames = (try? await app.db.reader.read { db in
                    try Dictionary(uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) })
                }) ?? [:]
            }
            .accessibilityIdentifier("huddle.grid")
        }
    }

    @ViewBuilder private var content: some View {
        if let sharerId = app.huddleScreenSharerId,
           let sharer = app.huddleTiles.first(where: { $0.userId == sharerId }),
           let share = sharer.screen {
            // A share takes the room; everyone else becomes a filmstrip.
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    SwiftUIVideoView(share, layoutMode: .fit, mirrorMode: .off)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    Text("\(name(sharerId)) is sharing")
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.muted)
                }
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(app.huddleTiles) { tile in
                            tileView(tile, height: 76)
                        }
                    }
                }
                .frame(width: 130)
            }
        } else if let focusedId = app.huddleFocusedUserId,
                  let focused = app.huddleTiles.first(where: { $0.userId == focusedId }) {
            VStack(spacing: 8) {
                tileView(focused, height: 220)
                strip(excluding: focusedId)
            }
        } else {
            strip(excluding: nil)
        }
    }

    private func strip(excluding: String?) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(app.huddleTiles.filter { $0.userId != excluding }) { tile in
                    tileView(tile, height: 110)
                }
            }
        }
    }

    private func tileView(_ tile: HuddleTile, height: CGFloat) -> some View {
        Button {
            app.huddleFocusedUserId = app.huddleFocusedUserId == tile.userId ? nil : tile.userId
        } label: {
            ZStack(alignment: .bottomLeading) {
                if let camera = tile.camera {
                    // Your own preview is mirrored, which is what people expect
                    // of a self-view and only of a self-view.
                    SwiftUIVideoView(camera, layoutMode: .fill, mirrorMode: tile.isLocal ? .mirror : .off)
                } else {
                    Color.black.opacity(0.65)
                    AvatarChip(
                        userId: tile.userId,
                        name: name(tile.userId),
                        avatarPath: app.avatarPaths[tile.userId],
                        size: min(height * 0.45, 72),
                        radius: 999
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                // Per-tile badges: mic and camera state, so the grid answers
                // "can they hear me / can I see them" without anyone asking.
                HStack(spacing: 4) {
                    // Is their voice path up (#508)? Same rule as the bar.
                    if !tile.isLocal {
                        Circle()
                            .fill(app.huddleTileConnected(tile) ? MC.online : Color.white.opacity(0.6))
                            .frame(width: 5, height: 5)
                    }
                    Image(systemName: tile.micOn ? "mic.fill" : "mic.slash.fill")
                    if tile.camera != nil { Image(systemName: "video.fill") }
                    Text(tile.isLocal ? "\(name(tile.userId)) (you)" : name(tile.userId))
                        .lineLimit(1)
                }
                .flowFont(size: 10, weight: .semibold)
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.45))
            }
            .frame(width: height * 16 / 9, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(tile.speaking ? MC.accent : MC.hairline, lineWidth: tile.speaking ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("huddle.tile.\(tile.userId)")
    }

    private func name(_ userId: String) -> String {
        userNames[userId] ?? "Someone"
    }
}
