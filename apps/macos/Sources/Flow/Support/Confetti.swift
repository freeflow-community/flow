import SwiftUI

// Confetti for a 🎉 (#524) — the native half of #514, and a port of the web
// client's `lib/confetti.ts`: when someone celebrates a message, the moment
// should look like a celebration for everyone with the channel open.
//
// Hand-rolled on one `Canvas` per window rather than a particle dependency:
// the whole effect is a second of falling rectangles. Particle positions are a
// pure function of the burst's age, so nothing mutates per frame — a
// `TimelineView(.animation)` redraws, and the overlay disappears entirely once
// the last burst has died, leaving a quiet workspace with no overlay at all.
//
// This file compiles into both apps (iOS pulls `Support/` in via project.yml),
// so the count-went-up rule exists once and neither client can drift from it.

/// Reactions that read as a celebration and so earn a burst. Mirrors
/// `CELEBRATION_EMOJI` in `packages/web/src/lib/confetti.ts`.
enum Celebration {
    static let emoji: Set<String> = ["🎉", "🎊"]
}

/// Celebration counts as we last saw them, per message. Process-level (like
/// `MessageScrollMemory`, and like the web module's `lastSeen` map) so a row
/// that remounts — switching channels and back, a thread opening — doesn't
/// replay bursts for reactions it already showed.
@MainActor
enum CelebrationMemory {
    /// Bound the memory on a long-lived session; oldest messages fall out first.
    static let limit = 2000

    private static var lastSeen: [String: [String: Int]] = [:]
    /// Swift dictionaries are unordered, so insertion order — which is what
    /// makes "oldest first" mean anything — is tracked alongside.
    private static var order: [String] = []

    /// Which celebration emoji were just *added* to this message, folding the
    /// new counts into memory as it goes.
    ///
    /// The first sighting of a message never fires: that is channel load,
    /// scrollback and every re-render of history, where existing reactions are
    /// just state. Only a count that goes up on a message we already rendered
    /// is someone celebrating right now — a local tap and another user's
    /// reaction arriving over the WS both land here the same way. A count that
    /// drops (removal) is recorded silently.
    static func celebrationsAdded(messageId: String, reactions: [ReactionAgg]) -> [String] {
        let before = lastSeen[messageId]
        var now: [String: Int] = [:]
        var added: [String] = []
        for r in reactions where Celebration.emoji.contains(r.emoji) {
            now[r.emoji] = r.count
            if let before, r.count > (before[r.emoji] ?? 0) { added.append(r.emoji) }
        }
        if before == nil {
            if lastSeen.count >= limit, !order.isEmpty {
                lastSeen[order.removeFirst()] = nil
            }
            order.append(messageId)
        }
        lastSeen[messageId] = now
        return added
    }

    /// Forget every message's counts. Tests only.
    static func reset() {
        lastSeen = [:]
        order = []
    }
}

// MARK: - The particle overlay

/// One particle's fixed properties. Its position at any moment is derived from
/// these and the burst's age, so a frame is a draw and never a mutation.
private struct ConfettiSeed {
    var vx: Double
    var vy: Double
    var rot: Double
    var vrot: Double
    var w: Double
    var h: Double
    var color: Color

    static func random() -> ConfettiSeed {
        // Up and outward, with enough spread that no two bursts look alike.
        let angle = -Double.pi / 2 + (Double.random(in: 0...1) - 0.5) * 1.6
        let speed = 180 + Double.random(in: 0...220)
        return ConfettiSeed(
            vx: cos(angle) * speed,
            vy: sin(angle) * speed,
            rot: Double.random(in: 0...Double.pi),
            vrot: (Double.random(in: 0...1) - 0.5) * 12,
            w: 5 + Double.random(in: 0...4),
            h: 8 + Double.random(in: 0...5),
            color: Color(hex: ConfettiPhysics.colors.randomElement() ?? 0xF9C7_4F)
        )
    }
}

/// The numbers, all lifted from the web module so the two look alike.
enum ConfettiPhysics {
    static let colors: [UInt32] = [
        0xF941_43, 0xF372_2C, 0xF9C7_4F, 0x43AA_8B, 0x4D90_8E, 0x9D4E_DD, 0xFF70_A6,
    ]
    /// Particles per burst, and the ceiling across all live bursts — a pile-on
    /// spends what is left of the budget and then stops spawning, so twenty
    /// rapid reactions cost the same frame as three.
    static let burstParticles = 26
    static let maxParticles = 200
    static let life: Double = 1.0
    /// pt/s² — tuned so a particle falls a few dozen points over its short life.
    static let gravity: Double = 900
}

private struct ConfettiBurst: Identifiable {
    let id = UUID()
    let origin: CGPoint
    let startedAt: Date
    let seeds: [ConfettiSeed]
}

/// The live bursts for one window. One controller per `confettiHost()`, handed
/// down the environment — so on macOS, where every window mounts its own root,
/// a burst renders in the window whose pill was reacted to and nowhere else.
@MainActor
final class ConfettiController: ObservableObject {
    /// Redrawing is driven by `TimelineView`; this publishes only when a burst
    /// starts or is reaped, which is what mounts and unmounts the overlay.
    @Published fileprivate private(set) var bursts: [ConfettiBurst] = []

    /// Where each reaction pill currently sits, in the host's coordinate space.
    /// Deliberately *not* published: pills report their frame on every scroll
    /// tick, and a published write there would re-render the transcript.
    private var pillCenters: [String: CGPoint] = [:]

    private static func pillKey(_ messageId: String, _ emoji: String) -> String {
        "\(messageId)\u{1}\(emoji)"
    }

    func notePill(messageId: String, emoji: String, center: CGPoint) {
        pillCenters[Self.pillKey(messageId, emoji)] = center
    }

    func forgetPill(messageId: String, emoji: String) {
        pillCenters[Self.pillKey(messageId, emoji)] = nil
    }

    func pillCenter(messageId: String, emoji: String) -> CGPoint? {
        pillCenters[Self.pillKey(messageId, emoji)]
    }

    /// Particles currently in flight, across every live burst.
    var liveParticleCount: Int { bursts.reduce(0) { $0 + $1.seeds.count } }

    /// Throw a short burst from a point in the host's coordinate space.
    /// Best-effort and decorative throughout: out of budget means no confetti,
    /// and the reaction itself is unaffected either way.
    func burst(at point: CGPoint, now: Date = Date()) {
        let room = ConfettiPhysics.maxParticles - liveParticleCount
        guard room > 0 else { return }
        let count = min(ConfettiPhysics.burstParticles, room)
        let burst = ConfettiBurst(
            origin: point,
            startedAt: now,
            seeds: (0..<count).map { _ in ConfettiSeed.random() }
        )
        bursts.append(burst)
        // Reaped on a timer rather than mid-draw: a `Canvas` closure must stay
        // a pure render, and this is the one place the array shrinks.
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(ConfettiPhysics.life * 1000) + 100))
            self?.bursts.removeAll { $0.id == burst.id }
        }
    }
}

/// The overlay itself: pinned over the whole host, click-through, invisible to
/// assistive tech, and absent entirely when nothing is flying.
private struct ConfettiCanvas: View {
    @ObservedObject var controller: ConfettiController

    var body: some View {
        if controller.bursts.isEmpty {
            Color.clear.frame(width: 0, height: 0)
        } else {
            TimelineView(.animation) { timeline in
                Canvas { ctx, _ in
                    for burst in controller.bursts {
                        draw(burst, at: timeline.date, in: &ctx)
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func draw(_ burst: ConfettiBurst, at date: Date, in ctx: inout GraphicsContext) {
        let age = date.timeIntervalSince(burst.startedAt)
        guard age >= 0, age < ConfettiPhysics.life else { return }
        // Fades over the last third of its life rather than blinking out.
        ctx.opacity = min(1, (ConfettiPhysics.life - age) / (ConfettiPhysics.life * 0.35))
        for seed in burst.seeds {
            let x = burst.origin.x + seed.vx * age
            let y = burst.origin.y + seed.vy * age + 0.5 * ConfettiPhysics.gravity * age * age
            let rect = CGRect(x: -seed.w / 2, y: -seed.h / 2, width: seed.w, height: seed.h)
            let transform = CGAffineTransform(translationX: x, y: y)
                .rotated(by: seed.rot + seed.vrot * age)
            ctx.fill(Path(rect).applying(transform), with: .color(seed.color))
        }
    }
}

// MARK: - Wiring

/// The coordinate space pills report into and the canvas draws in.
private let confettiSpace = "flow.confetti"

private struct ConfettiControllerKey: EnvironmentKey {
    static let defaultValue: ConfettiController? = nil
}

extension EnvironmentValues {
    /// nil outside a `confettiHost()` — every source below no-ops rather than
    /// trapping, because decoration must never be able to break a reaction.
    fileprivate var confettiController: ConfettiController? {
        get { self[ConfettiControllerKey.self] }
        set { self[ConfettiControllerKey.self] = newValue }
    }
}

private struct ConfettiHostModifier: ViewModifier {
    @StateObject private var controller = ConfettiController()

    func body(content: Content) -> some View {
        content
            .coordinateSpace(name: confettiSpace)
            .environment(\.confettiController, controller)
            .overlay(ConfettiCanvas(controller: controller))
    }
}

/// Reports a reaction pill's position so a burst can start where the pill is.
/// Cheap by construction: the frame lands in unpublished storage, so tracking
/// it through a scroll costs no re-render of the transcript.
private struct ConfettiPillModifier: ViewModifier {
    let messageId: String
    let emoji: String
    @Environment(\.confettiController) private var controller

    func body(content: Content) -> some View {
        content.background(
            GeometryReader { geo in
                let frame = geo.frame(in: .named(confettiSpace))
                Color.clear
                    .onAppear { note(frame) }
                    .onChange(of: frame) { _, new in note(new) }
                    .onDisappear { controller?.forgetPill(messageId: messageId, emoji: emoji) }
            }
        )
    }

    private func note(_ frame: CGRect) {
        controller?.notePill(
            messageId: messageId, emoji: emoji,
            center: CGPoint(x: frame.midX, y: frame.midY)
        )
    }
}

/// Watches a message's reaction aggregates and bursts from the pill that just
/// went up. Goes on the *message row*, not on the reaction row: a message with
/// no reactions yet renders no reaction row at all, and if the memory only
/// started there, the first 🎉 on a message would look like a first sighting
/// and stay silent — which is the one case anyone tries first.
private struct CelebrationBurstsModifier: ViewModifier {
    let messageId: String
    let reactions: [ReactionAgg]
    @Environment(\.confettiController) private var controller
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            // `initial: true` is what records the first sighting — and a first
            // sighting is silent by construction, so channel load, scrollback
            // and a row remounting animate nothing.
            .onChange(of: reactions, initial: true) { _, current in
                fire(current)
            }
    }

    private func fire(_ current: [ReactionAgg]) {
        let added = CelebrationMemory.celebrationsAdded(messageId: messageId, reactions: current)
        // Memory is folded in even under Reduce Motion, so turning it off
        // mid-session doesn't then replay a backlog of old reactions.
        guard !added.isEmpty, !reduceMotion, let controller else { return }
        // One hop, so a pill that only just appeared has been laid out and can
        // report where it is before we ask.
        Task { @MainActor in
            for emoji in added {
                guard let origin = controller.pillCenter(messageId: messageId, emoji: emoji)
                    ?? controller.pillCenter(messageId: messageId, emoji: "")
                else { continue }
                controller.burst(at: origin)
            }
        }
    }
}

extension View {
    /// Mount the confetti overlay and the coordinate space its sources report
    /// into. Once, at the root of a window.
    func confettiHost() -> some View {
        modifier(ConfettiHostModifier())
    }

    /// One reaction pill: where a burst for this emoji should start.
    func confettiPill(messageId: String, emoji: String) -> some View {
        modifier(ConfettiPillModifier(messageId: messageId, emoji: emoji))
    }

    /// The reaction row as a whole — the fallback origin for an emoji whose
    /// pill has only just appeared and has not reported a frame yet. The empty
    /// emoji is the key, which no real pill can claim.
    func confettiReactionRow(messageId: String) -> some View {
        modifier(ConfettiPillModifier(messageId: messageId, emoji: ""))
    }

    /// The message row: fires a burst when a 🎉/🎊 count goes up on it.
    func celebrationBursts(messageId: String, reactions: [ReactionAgg]) -> some View {
        modifier(CelebrationBurstsModifier(messageId: messageId, reactions: reactions))
    }
}
