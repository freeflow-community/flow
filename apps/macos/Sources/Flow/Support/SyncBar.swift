import SwiftUI

/// The thin reconnect/catch-up bar at the top of a chat transcript (#234), and
/// the timing that keeps it from flickering.
///
/// Shared by macOS and iOS: `AppState.isSyncing` is the input on both, so the
/// look and the timing are defined once here rather than twice in the views.
/// The web client mirrors the same two numbers in `useSyncBar`.

/// Turns "is the app syncing right now" into "should a bar be on screen",
/// applying a show-delay and a minimum visible duration.
///
/// Both numbers exist for the same reason: a reconnect that resolves in 200 ms
/// should draw nothing at all, and one that resolves in 300 ms should not flash
/// a bar for 50 ms. Kept out of the view so it can be tested without one.
@MainActor
final class SyncIndicator: ObservableObject {
    /// Syncing must last this long before anything is drawn.
    static let showDelay: Duration = .milliseconds(250)
    /// Once drawn, the bar stays at least this long.
    static let minimumVisible: Duration = .milliseconds(500)

    @Published private(set) var visible = false

    private let showDelay: Duration
    private let minimumVisible: Duration
    /// The one in-flight show-or-hide. Cancelled on every state change, so the
    /// latest input always wins.
    private var pending: Task<Void, Never>?
    private var shownAt: ContinuousClock.Instant?

    init(
        showDelay: Duration = SyncIndicator.showDelay,
        minimumVisible: Duration = SyncIndicator.minimumVisible
    ) {
        self.showDelay = showDelay
        self.minimumVisible = minimumVisible
    }

    deinit { pending?.cancel() }

    func update(syncing: Bool) {
        pending?.cancel()
        pending = nil
        if syncing {
            guard !visible else { return }  // already up — and a hide just got cancelled
            pending = Task { [weak self] in
                guard let self else { return }
                try? await Task.sleep(for: self.showDelay)
                guard !Task.isCancelled else { return }
                self.visible = true
                self.shownAt = ContinuousClock.now
            }
        } else {
            guard visible else { return }  // never made it on screen — nothing to hide
            let elapsed = shownAt.map { ContinuousClock.now - $0 } ?? .zero
            let remaining = minimumVisible - elapsed
            guard remaining > .zero else { return hide() }
            pending = Task { [weak self] in
                try? await Task.sleep(for: remaining)
                guard !Task.isCancelled else { return }
                self?.hide()
            }
        }
    }

    private func hide() {
        visible = false
        shownAt = nil
    }
}

/// A 2pt indeterminate bar, drawn only while `syncing` holds long enough to be
/// worth showing. Sits under a channel header; occupies no height when idle.
struct SyncBar: View {
    let syncing: Bool
    @StateObject private var indicator = SyncIndicator()

    var body: some View {
        Group {
            if indicator.visible {
                SyncBarTrack()
                    .frame(height: 2)
                    .transition(.opacity)
                    .accessibilityIdentifier("sync-bar")
                    .accessibilityLabel("Reconnecting")
            }
        }
        .animation(.easeInOut(duration: 0.15), value: indicator.visible)
        .onChange(of: syncing, initial: true) { _, now in
            indicator.update(syncing: now)
        }
    }
}

/// The moving segment. Indeterminate on purpose — a reconnect has no progress
/// to report, and a fake percentage would be a lie the user can see stall.
private struct SyncBarTrack: View {
    @State private var sliding = false

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let segment = max(60, width * 0.3)
            Rectangle()
                .fill(MC.accent.opacity(0.12))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(MC.accent)
                        .frame(width: segment)
                        .offset(x: sliding ? width : -segment)
                }
                .clipped()
                .onAppear {
                    withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) {
                        sliding = true
                    }
                }
        }
    }
}
