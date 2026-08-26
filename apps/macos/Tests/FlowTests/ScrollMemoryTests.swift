import Foundation
import XCTest

@testable import Flow

/// The per-channel scroll-position store behind "switching back returns you
/// to where you were" (macOS). The interesting rules: entries expire after
/// the TTL, and a reader who returned to the bottom clears theirs.
@MainActor
final class ScrollMemoryTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MessageScrollMemory.reset()
    }

    func testRecordAndFresh() {
        MessageScrollMemory.record("c1", topMessageId: "m5")
        XCTAssertEqual(MessageScrollMemory.fresh("c1"), "m5")
    }

    func testUnknownChannelIsNil() {
        XCTAssertNil(MessageScrollMemory.fresh("c9"))
    }

    func testNewerRecordWins() {
        MessageScrollMemory.record("c1", topMessageId: "m5")
        MessageScrollMemory.record("c1", topMessageId: "m8")
        XCTAssertEqual(MessageScrollMemory.fresh("c1"), "m8")
    }

    func testEntriesAreForgottenAfterTheTTL() {
        let then = Date()
        MessageScrollMemory.record("c1", topMessageId: "m5", at: then)
        let justUnder = then.addingTimeInterval(MessageScrollMemory.ttl - 1)
        XCTAssertEqual(MessageScrollMemory.fresh("c1", at: justUnder), "m5")
        let justOver = then.addingTimeInterval(MessageScrollMemory.ttl + 1)
        XCTAssertNil(MessageScrollMemory.fresh("c1", at: justOver))
        // Expiry drops the entry for good — a later in-window read stays nil.
        XCTAssertEqual(MessageScrollMemory.fresh("c1", at: justUnder), nil)
    }

    func testClearForgets() {
        MessageScrollMemory.record("c1", topMessageId: "m5")
        MessageScrollMemory.clear("c1")
        XCTAssertNil(MessageScrollMemory.fresh("c1"))
    }

    func testChannelsAreIndependent() {
        MessageScrollMemory.record("c1", topMessageId: "m5")
        MessageScrollMemory.record("c2", topMessageId: "m7")
        MessageScrollMemory.clear("c1")
        XCTAssertNil(MessageScrollMemory.fresh("c1"))
        XCTAssertEqual(MessageScrollMemory.fresh("c2"), "m7")
    }
}
