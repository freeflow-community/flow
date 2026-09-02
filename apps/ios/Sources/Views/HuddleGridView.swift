import LiveKit
import SwiftUI

/// The huddle's video surface, phone-sized (#435). Same rule as macOS —
/// `HuddleBar` is the audio-only face, this appears the moment anyone turns on
/// a camera or shares, and collapses back when the last one stops — but laid
/// out for one narrow column: a share (or the focused tile) on top, everyone
/// else in a horizontal strip under it. A phone never has room for an even
/// grid of more than about four, and picking the layout by count would make
/// the screen jump every time someone joins.
struct HuddleGridView: View {
    @EnvironmentObject private var app: AppState
    @State private var userNames: [String: String] = [:]

    var body: some View {
        if app.activeHuddleChannelId != nil, app.huddleHasVideo {
            VStack(spacing: 6) {
                if let notice = app.huddleNotice {
                    Text(notice)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(MC.muted)
                        .accessibilityIdentifier("huddle.notice")
                }
                hero
                strip
            }
            .padding(8)
            .background(MC.daypill.opacity(0.5))
            .task(id: app.activeHuddleChannelId) {
                userNames = (try? await app.db.reader.read { db in
                    try Dictionary(uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) })
                }) ?? [:]
            }
            .accessibilityIdentifier("huddle.grid")
        }
    }

    /// The big tile: a live share wins, then an explicitly focused tile, then
    /// whoever is speaking, then the first camera on. iOS can *view* any share
    /// — it just can't publish a full-screen one without a Broadcast Upload
    /// Extension, which this PR defers.
    @ViewBuilder private var hero: some View {
        if let sharerId = app.huddleScreenSharerId,
           let sharer = app.huddleTiles.first(where: { $0.userId == sharerId }),
           let share = sharer.screen {
            VStack(alignment: .leading, spacing: 3) {
                SwiftUIVideoView(share, layoutMode: .fit, mirrorMode: .off)
                    .background(Color.black)
                    .frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text("\(name(sharerId)) is sharing")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(MC.muted)
            }
        } else if let focused = heroTile {
            tileView(focused, height: 180, wide: true)
        }
    }

    private var heroTile: HuddleTile? {
        if let id = app.huddleFocusedUserId, let t = app.huddleTiles.first(where: { $0.userId == id }) { return t }
        if let speaking = app.huddleTiles.first(where: { $0.speaking && $0.camera != nil }) { return speaking }
        return app.huddleTiles.first { $0.camera != nil }
    }

    private var strip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(app.huddleTiles.filter { $0.userId != heroTile?.userId }) { tile in
                    tileView(tile, height: 76)
                }
            }
        }
    }

    private func tileView(_ tile: HuddleTile, height: CGFloat, wide: Bool = false) -> some View {
        Button {
            app.huddleFocusedUserId = app.huddleFocusedUserId == tile.userId ? nil : tile.userId
        } label: {
            ZStack(alignment: .bottomLeading) {
                if let camera = tile.camera {
                    SwiftUIVideoView(camera, layoutMode: .fill, mirrorMode: tile.isLocal ? .mirror : .off)
                } else {
                    Color.black.opacity(0.65)
                    AvatarChip(
                        userId: tile.userId,
                        name: name(tile.userId),
                        avatarPath: app.avatarPaths[tile.userId],
                        size: min(height * 0.45, 60),
                        radius: 999
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                HStack(spacing: 3) {
                    Image(systemName: tile.micOn ? "mic.fill" : "mic.slash.fill")
                    if tile.camera != nil { Image(systemName: "video.fill") }
                    Text(tile.isLocal ? "You" : name(tile.userId)).lineLimit(1)
                }
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.45))
            }
            // The hero fills the column; strip tiles keep 16:9, which is what
            // makes the strip scroll instead of squeezing.
            .frame(maxWidth: wide ? .infinity : nil)
            .frame(width: wide ? nil : height * 16 / 9, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
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
