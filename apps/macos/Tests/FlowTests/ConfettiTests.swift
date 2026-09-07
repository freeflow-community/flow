import CoreGraphics
import XCTest

@testable import Flow

/// The count-went-up rule behind a 🎉 confetti burst (#524), ported case for
/// case from the web client's `lib/confetti.test.ts` — the two clients share a
/// rule, so they should share the suite that pins it down.
@MainActor
final class CelebrationMemoryTests: XCTestCase {
    override func setUp() {
        super.setUp()
        CelebrationMemory.reset()
    }

    private func agg(_ emoji: String, _ count: Int) -> ReactionAgg {
        ReactionAgg(emoji: emoji, count: count, userIds: [])
    }

    private func added(_ messageId: String, _ reactions: [ReactionAgg]) -> [String] {
        CelebrationMemory.celebrationsAdded(messageId: messageId, reactions: reactions)
    }

    func testStaysSilentTheFirstTimeItSeesAMessage() {
        // Channel load and scrollback: the 🎉 is history, not a celebration.
        XCTAssertEqual(added("m1", [agg("🎉", 3)]), [])
    }

    func testFiresWhenACelebrationCountGoesUpOnAMessageItHasSeen() {
        _ = added("m1", [])
        XCTAssertEqual(added("m1", [agg("🎉", 1)]), ["🎉"])
        XCTAssertEqual(added("m1", [agg("🎉", 2)]), ["🎉"])
    }

    func testFiresForConfettiBallAsWell() {
        _ = added("m1", [])
        XCTAssertEqual(added("m1", [agg("🎊", 1)]), ["🎊"])
    }

    func testStaysSilentOnAnUnchangedCount() {
        _ = added("m1", [agg("🎉", 1)])
        XCTAssertEqual(added("m1", [agg("🎉", 1)]), [])
    }

    func testStaysSilentOnRemovalAndOnAReturnToALowerCount() {
        _ = added("m1", [])
        _ = added("m1", [agg("🎉", 2)])
        XCTAssertEqual(added("m1", [agg("🎉", 1)]), [])
        XCTAssertEqual(added("m1", []), [])
    }

    func testIgnoresEmojiThatAreNotCelebrations() {
        _ = added("m1", [])
        XCTAssertEqual(added("m1", [agg("👍", 1), agg("🛑", 4)]), [])
    }

    func testTracksMessagesIndependently() {
        _ = added("m1", [])
        XCTAssertEqual(added("m2", [agg("🎉", 1)]), [])
        XCTAssertEqual(added("m1", [agg("🎉", 1)]), ["🎉"])
    }

    func testAMessageDroppedByTheMemoryBoundIsSilentWhenItComesBack() {
        // Past the bound the oldest entry is evicted, which makes that message
        // a first sighting again — silent, never a replayed burst.
        _ = added("old", [])
        for i in 0..<CelebrationMemory.limit { _ = added("m\(i)", []) }
        XCTAssertEqual(added("old", [agg("🎉", 1)]), [])
        // The most recent messages are still remembered.
        XCTAssertEqual(added("m\(CelebrationMemory.limit - 1)", [agg("🎉", 1)]), ["🎉"])
    }
}

/// The overlay's budget. The animation itself is a pure function of a burst's
/// age, so what is worth pinning is the ceiling that keeps a pile-on cheap.
@MainActor
final class ConfettiControllerTests: XCTestCase {
    func testABurstSpawnsAFullSetOfParticles() {
        let controller = ConfettiController()
        XCTAssertEqual(controller.liveParticleCount, 0)
        controller.burst(at: CGPoint(x: 300, y: 400))
        XCTAssertEqual(controller.liveParticleCount, ConfettiPhysics.burstParticles)
    }

    func testCapsTheParticleCountSoAPileOnStaysCheap() {
        let controller = ConfettiController()
        for _ in 0..<20 { controller.burst(at: CGPoint(x: 300, y: 400)) }
        XCTAssertEqual(controller.liveParticleCount, ConfettiPhysics.maxParticles)
    }

    func testPillCentresAreRememberedPerMessageAndEmoji() {
        let controller = ConfettiController()
        XCTAssertNil(controller.pillCenter(messageId: "m1", emoji: "🎉"))
        controller.notePill(messageId: "m1", emoji: "🎉", center: CGPoint(x: 10, y: 20))
        controller.notePill(messageId: "m1", emoji: "🎊", center: CGPoint(x: 30, y: 40))
        XCTAssertEqual(controller.pillCenter(messageId: "m1", emoji: "🎉"), CGPoint(x: 10, y: 20))
        XCTAssertEqual(controller.pillCenter(messageId: "m1", emoji: "🎊"), CGPoint(x: 30, y: 40))
        XCTAssertNil(controller.pillCenter(messageId: "m2", emoji: "🎉"))

        controller.forgetPill(messageId: "m1", emoji: "🎉")
        XCTAssertNil(controller.pillCenter(messageId: "m1", emoji: "🎉"))
    }
}
