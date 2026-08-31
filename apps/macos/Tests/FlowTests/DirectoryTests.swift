import XCTest
@testable import Flow

/// The Directory's search, labels and states (#432) — the rule macOS and iOS
/// share, mirroring the web client's `DirectoryView.test.tsx` (#430) case for
/// case, because the two clients must narrow identically: someone who finds a
/// colleague by typing "scottp" on the Mac has to find them the same way on
/// their phone.
final class DirectoryTests: XCTestCase {
    private struct Row: DirectoryMember {
        var userId: String
        var displayName: String
        var email: String
        var role: String = "member"
        var statusEmoji: String?
        var statusText: String?
        var isAgent: Bool?
        var isBot: Bool?
        var sponsorId: String?
    }

    private func row(
        _ name: String,
        email: String? = nil,
        role: String = "member",
        isAgent: Bool = false,
        isBot: Bool = false,
        sponsorId: String? = nil
    ) -> Row {
        Row(
            userId: "u-\(name)",
            displayName: name,
            email: email ?? "\(name.lowercased())@example.com",
            role: role,
            isAgent: isAgent,
            isBot: isBot,
            sponsorId: sponsorId
        )
    }

    private func names(_ rows: [Row]) -> [String] { rows.map(\.displayName) }

    // MARK: - filter

    func testSortsAlphabeticallyCaseInsensitivelyWithAgentsMixedIn() {
        let rows = [row("zoe"), row("CypressBot", isAgent: true), row("Ada")]
        XCTAssertEqual(names(Directory.filter(rows, query: "")), ["Ada", "CypressBot", "zoe"])
    }

    func testNarrowsByCaseInsensitiveNameSubstring() {
        let rows = [row("Ada Lovelace"), row("Alan Turing")]
        XCTAssertEqual(names(Directory.filter(rows, query: "ada")), ["Ada Lovelace"])
        XCTAssertEqual(names(Directory.filter(rows, query: "TUR")), ["Alan Turing"])
    }

    func testMatchesEmailLocalPartButNeverTheDomain() {
        let rows = [row("Scott", email: "scottp@biztrip.ai"), row("Ada")]
        XCTAssertEqual(names(Directory.filter(rows, query: "scottp")), ["Scott"])
        // "example"/"biztrip" would otherwise match members through their domain,
        // which every human in a workspace tends to share.
        XCTAssertTrue(Directory.filter(rows, query: "biztrip").isEmpty)
        XCTAssertTrue(Directory.filter(rows, query: "example").isEmpty)
    }

    func testIgnoresAnAgentsSyntheticAddress() {
        // agent-<uuid>@agents.flow.local — matching it is only ever an accident.
        let rows = [row("Prism", email: "agent-01a0-beef@agents.flow.local", isAgent: true)]
        XCTAssertEqual(names(Directory.filter(rows, query: "prism")), ["Prism"])
        XCTAssertTrue(Directory.filter(rows, query: "beef").isEmpty)
    }

    func testIgnoresAnAppBotsSyntheticAddress() {
        let rows = [row("Deploybot", email: "bot-01a0-cafe@agents.flow.local", isBot: true)]
        XCTAssertEqual(names(Directory.filter(rows, query: "deploy")), ["Deploybot"])
        XCTAssertTrue(Directory.filter(rows, query: "cafe").isEmpty)
    }

    func testTrimsAndIgnoresSurroundingWhitespace() {
        let rows = [row("Ada"), row("Alan")]
        XCTAssertEqual(names(Directory.filter(rows, query: "  ada  ")), ["Ada"])
        XCTAssertEqual(names(Directory.filter(rows, query: "   ")), ["Ada", "Alan"])
    }

    func testDoesNotMutateTheInput() {
        let rows = [row("zoe"), row("Ada")]
        _ = Directory.filter(rows, query: "")
        XCTAssertEqual(names(rows), ["zoe", "Ada"])
    }

    func testEmailWithoutAnAtSignIsItsOwnLocalPart() {
        XCTAssertEqual(Directory.emailLocalPart("Scottp@Biztrip.ai"), "scottp")
        XCTAssertEqual(Directory.emailLocalPart("malformed"), "malformed")
    }

    // MARK: - labels

    func testKindLabelNamesAgentsAndAppsRatherThanARole() {
        XCTAssertEqual(Directory.kindLabel(row("Prism", isAgent: true)), "AI agent")
        XCTAssertEqual(Directory.kindLabel(row("Deploybot", isBot: true)), "App")
        XCTAssertEqual(Directory.kindLabel(row("Ada", role: "owner")), "Owner")
        XCTAssertEqual(Directory.kindLabel(row("Alan", role: "admin")), "Admin")
        XCTAssertEqual(Directory.kindLabel(row("Zoe", role: "member")), "Member")
        // An unknown role is shown as-is rather than dropped.
        XCTAssertEqual(Directory.kindLabel(row("Guest", role: "guest")), "guest")
    }

    func testContactLineNamesAnAgentsSponsorInsteadOfItsAddress() {
        let agent = row("Prism", email: "agent-01a0@agents.flow.local", isAgent: true, sponsorId: "u-Ada")
        XCTAssertEqual(Directory.contactLine(agent, sponsorName: "Ada"), "Sponsored by Ada")
        // No sponsor resolved: better an empty line than an unwritable address.
        XCTAssertEqual(Directory.contactLine(agent, sponsorName: nil), "")
        XCTAssertEqual(Directory.contactLine(row("Deploybot", isBot: true), sponsorName: nil), "")
        XCTAssertEqual(
            Directory.contactLine(row("Ada", email: "ada@example.com"), sponsorName: nil),
            "ada@example.com"
        )
    }

    func testCountLabelSingularizes() {
        XCTAssertEqual(Directory.countLabel(0), "0 people")
        XCTAssertEqual(Directory.countLabel(1), "1 person")
        XCTAssertEqual(Directory.countLabel(11), "11 people")
    }

    // MARK: - states

    func testDistinguishesLoadingAnEmptyWorkspaceAndAQueryWithNoMatch() {
        XCTAssertEqual(
            Directory.emptyState(total: 0, shown: 0, loading: true, query: ""), .loading
        )
        XCTAssertEqual(
            Directory.emptyState(total: 0, shown: 0, loading: false, query: ""), .noMembers
        )
        XCTAssertEqual(
            Directory.emptyState(total: 11, shown: 0, loading: false, query: " zzzz "),
            .noMatch("zzzz")
        )
        // A cache that already has rows draws them rather than a spinner, even
        // while the refresh is still in flight.
        XCTAssertNil(Directory.emptyState(total: 11, shown: 11, loading: true, query: ""))
    }

    func testEmptyStateMessages() {
        XCTAssertEqual(Directory.EmptyState.loading.message, "Loading…")
        XCTAssertEqual(Directory.EmptyState.noMembers.message, "Nobody is here yet.")
        XCTAssertEqual(Directory.EmptyState.noMatch("zzzz").message, "No one matches “zzzz”.")
    }
}
