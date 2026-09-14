import XCTest
@testable import Flow

/// The multi-device / group-DM ring rule (#436). Same cases as the web
/// client's huddleRing.test.ts — the two implementations have to agree, since
/// one person's laptop and phone are reading the same event.
final class HuddleRingTests: XCTestCase {
    private let me = "u-me"
    private let caller = "u-caller"

    private func invite(
        status: HuddleInviteStatus = .ringing,
        targets: [HuddleInviteTarget]? = nil
    ) -> HuddleInvite {
        HuddleInvite(
            id: "i1", workspaceId: "w1", channelId: "c1", startedBy: caller,
            status: status, startedAt: "2026-09-02T00:00:00.000Z",
            answeredAt: nil, endedAt: nil,
            targets: targets ?? [HuddleInviteTarget(userId: me, status: .ringing, respondedAt: nil)]
        )
    }

    func testRingsATargetStillRinging() {
        XCTAssertEqual(ringEffect(invite(), selfId: me, mySessionId: "s1"), .ring(invite()))
    }

    func testIgnoresAnInviteWeAreNotATargetOf() {
        XCTAssertEqual(ringEffect(invite(), selfId: "u-other", mySessionId: "s1"), .ignore)
    }

    func testDismissesOnTheDeviceThatAnswered() {
        let accepted = invite(status: .active, targets: [.init(userId: me, status: .accepted, respondedAt: "x")])
        XCTAssertEqual(
            ringEffect(accepted, selfId: me, mySessionId: "s1", answeredBySessionId: "s1"),
            .dismiss
        )
    }

    func testExplainsItselfOnTheOtherDevices() {
        let accepted = invite(status: .active, targets: [.init(userId: me, status: .accepted, respondedAt: "x")])
        XCTAssertEqual(
            ringEffect(accepted, selfId: me, mySessionId: "s2", answeredBySessionId: "s1"),
            .answeredElsewhere
        )
    }

    func testKeepsAGroupDMCardUpAfterSomeoneElseAccepts() {
        // Late join is allowed while the call is active, so the first accept
        // must not yank the ring away from everyone still being called.
        let active = invite(status: .active, targets: [
            .init(userId: "u-them", status: .accepted, respondedAt: "x"),
            .init(userId: me, status: .ringing, respondedAt: nil),
        ])
        XCTAssertEqual(ringEffect(active, selfId: me, mySessionId: "s1"), .ring(active))
    }

    func testTracksTheCallersOwnRing() {
        XCTAssertEqual(
            ringEffect(invite(), selfId: caller, mySessionId: "s1", unavailable: ["Bob"]),
            .outgoing(invite(), unavailable: ["Bob"])
        )
        XCTAssertEqual(
            ringEffect(invite(status: .missed), selfId: caller, mySessionId: "s1"),
            .outgoing(nil, unavailable: [])
        )
    }
}
