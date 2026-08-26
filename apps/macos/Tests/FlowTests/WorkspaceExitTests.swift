import XCTest
@testable import Flow

/// Which way out the workspace menu offers (#340), and specifically the case
/// that shipped broken: the roster is a *cached* list that reads empty until
/// the members fetch lands, and treating empty as "nobody else here" offered
/// Delete on workspaces full of people. The server refused with 409, and on
/// iOS the refusal wasn't rendered at all — so it looked like Delete simply
/// did nothing.
final class WorkspaceExitTests: XCTestCase {
    private struct Row: WorkspaceRosterMember {
        var userId: String
        var isAgent: Bool?
        var isBot: Bool?
    }

    private let me = "me"
    private func human(_ id: String) -> Row { Row(userId: id, isAgent: false, isBot: false) }
    private func agent(_ id: String) -> Row { Row(userId: id, isAgent: true, isBot: false) }
    private func bot(_ id: String) -> Row { Row(userId: id, isAgent: false, isBot: true) }

    func testAMemberJustLeaves() {
        XCTAssertEqual(
            WorkspaceExit.offered(role: "member", roster: [human(me), human("b")], me: me),
            .leave
        )
        XCTAssertEqual(
            WorkspaceExit.offered(role: "admin", roster: [human(me), human("b")], me: me),
            .leave
        )
    }

    func testAnOwnerWithCompanyMustTransferFirst() {
        XCTAssertEqual(
            WorkspaceExit.offered(role: "owner", roster: [human(me), human("b")], me: me),
            .transferFirst
        )
    }

    func testAnOwnerAloneMayDelete() {
        XCTAssertEqual(WorkspaceExit.offered(role: "owner", roster: [human(me)], me: me), .delete)
    }

    func testAgentsAndBotsAreNotCompany() {
        let roster = [human(me), agent("a"), bot("b")]
        XCTAssertEqual(WorkspaceExit.offered(role: "owner", roster: roster, me: me), .delete)
    }

    // MARK: - The regression

    func testAnEmptyRosterIsNotTakenForBeingAlone() {
        // The bug: `humans.count <= 1` is true of an empty list, so every
        // workspace whose members hadn't loaded offered Delete.
        XCTAssertEqual(WorkspaceExit.offered(role: "owner", roster: [Row](), me: me), .transferFirst)
    }

    func testARosterWithoutUsIsNotTrustedEither() {
        // Mid-refresh the rows can be *someone else's* workspace. Not finding
        // ourselves means we don't know who is here, which is not the same as
        // being alone.
        XCTAssertEqual(
            WorkspaceExit.offered(role: "owner", roster: [human("a"), human("b")], me: me),
            .transferFirst
        )
    }

    func testNotKnowingWhoWeAreIsNotBeingAlone() {
        XCTAssertEqual(WorkspaceExit.offered(role: "owner", roster: [human(me)], me: nil), .transferFirst)
    }

    func testAnEmptyRosterStillLetsANonOwnerLeave() {
        // The safe fallback must not take Leave away from a plain member: it is
        // not destructive, and the server is the one that decides.
        XCTAssertEqual(WorkspaceExit.offered(role: "member", roster: [Row](), me: me), .leave)
    }

    func testNoRoleYetIsTreatedAsAPlainMember() {
        XCTAssertEqual(WorkspaceExit.offered(role: nil, roster: [human(me)], me: me), .leave)
    }
}
