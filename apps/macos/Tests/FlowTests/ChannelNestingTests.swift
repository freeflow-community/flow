import Foundation
import XCTest

@testable import Flow

/// Sub-channel display order (#118). Shared by the macOS and iOS sidebars, so a
/// break here is a break on both. The rule worth pinning is the fallback: a
/// child whose parent isn't in the list still has to appear, or you lose a
/// channel you're a member of.
final class ChannelNestingTests: XCTestCase {
    private func chan(_ id: String, parent: String? = nil, kind: String = "standard") -> Channel {
        Channel(
            id: id, workspaceId: "w1", name: id, kind: kind, topic: nil, isPrivate: false,
            createdBy: "u1", createdAt: "2026-07-29T00:00:00Z", archivedAt: nil, isMember: true,
            lastReadMsgId: nil, unreadCount: 0, unreadNotifications: 0, notifyLevel: 1, parentId: parent
        )
    }

    /// "alpha, then an indented zeta" reads as `["alpha", "  zeta"]`.
    private func shape(_ list: [Channel]) -> [String] {
        Channel.nested(list).map { ($0.isNested ? "  " : "") + $0.channel.id }
    }

    func testFlatListIsUnchanged() {
        XCTAssertEqual(shape([chan("alpha"), chan("beta")]), ["alpha", "beta"])
    }

    func testChildSitsUnderItsParent() {
        XCTAssertEqual(shape([chan("alpha"), chan("zeta", parent: "alpha")]), ["alpha", "  zeta"])
    }

    /// The server sorts by name, so a child usually arrives nowhere near its
    /// parent — the ordinary case, not an edge case.
    func testChildIsPulledUpToItsParent() {
        XCTAssertEqual(
            shape([chan("alpha"), chan("beta"), chan("gamma", parent: "alpha")]),
            ["alpha", "  gamma", "beta"]
        )
    }

    func testSeveralChildrenKeepInputOrder() {
        XCTAssertEqual(
            shape([chan("alpha"), chan("one", parent: "alpha"), chan("two", parent: "alpha")]),
            ["alpha", "  one", "  two"]
        )
    }

    /// You can be in a child without being in its parent, and the parent may be
    /// archived and filtered out before this is called.
    func testOrphanRendersAtTopLevel() {
        XCTAssertEqual(shape([chan("orphan", parent: "not-here")]), ["orphan"])
    }

    /// The server rejects grandchildren. One arriving anyway falls back to top
    /// level — the first version of this dropped it from the sidebar entirely.
    func testNeverNestsDeeperThanOneLevel() {
        XCTAssertEqual(
            shape([chan("alpha"), chan("kid", parent: "alpha"), chan("grandkid", parent: "kid")]),
            ["alpha", "  kid", "grandkid"]
        )
    }

    func testEveryChannelSurvives() {
        let list = [chan("a"), chan("b", parent: "a"), chan("c", parent: "gone"), chan("d")]
        XCTAssertEqual(Channel.nested(list).count, list.count)
    }
}
