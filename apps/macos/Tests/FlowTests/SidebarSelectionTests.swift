import Foundation
import XCTest

@testable import Flow

/// Which sidebar row draws the selected pill (#113). The Activity feed and the
/// artifact panel both sit over the channel selection without clearing it, so
/// the highlight rule has to exclude them explicitly — the reported bug was
/// Activity and the previous channel showing as selected at the same time.
final class SidebarSelectionTests: XCTestCase {
    private func highlighted(
        selected: String? = "c1", artifact: String? = nil, activity: Bool = false
    ) -> Bool {
        AppState.channelRowHighlighted(
            rowId: "c1", selectedChannelId: selected,
            selectedArtifactId: artifact, showActivity: activity
        )
    }

    func testSelectedChannelIsHighlighted() {
        XCTAssertTrue(highlighted())
    }

    func testOtherChannelIsNotHighlighted() {
        XCTAssertFalse(highlighted(selected: "c2"))
    }

    func testNothingSelectedIsNotHighlighted() {
        XCTAssertFalse(highlighted(selected: nil))
    }

    /// The regression: Activity takes the pill, so the channel behind it lets go.
    func testActivityFeedTakesTheHighlightFromItsChannel() {
        XCTAssertFalse(highlighted(activity: true))
    }

    func testOpenArtifactTakesTheHighlightFromItsChannel() {
        XCTAssertFalse(highlighted(artifact: "a1"))
    }

    func testActivityOverAnArtifactStillYields() {
        XCTAssertFalse(highlighted(artifact: "a1", activity: true))
    }

    /// Activity is a client-only row with no channel of its own, so showing it
    /// must not highlight some unrelated channel either.
    func testActivityDoesNotHighlightAnUnselectedChannel() {
        XCTAssertFalse(highlighted(selected: "c2", activity: true))
    }

    /// Closing Activity returns the pill to the channel that was behind it —
    /// this is why the fix belongs in the row predicate and not in a mutation
    /// that clears `selectedChannelId`.
    func testChannelRegainsHighlightWhenActivityCloses() {
        XCTAssertFalse(highlighted(activity: true))
        XCTAssertTrue(highlighted(activity: false))
    }
}

/// Scroll identity for sidebar rows (#319).
final class SidebarRowIDTests: XCTestCase {
    func testRowIDIsStableForAChannel() {
        XCTAssertEqual(AppState.sidebarRowID("c1"), AppState.sidebarRowID("c1"))
    }

    func testDifferentChannelsGetDifferentRowIDs() {
        XCTAssertNotEqual(AppState.sidebarRowID("c1"), AppState.sidebarRowID("c2"))
    }

    /// The reason it is namespaced: the bare channel id already identifies the
    /// `ForEach` element wrapping the row *and its pinned artifacts*, and the
    /// scroll target has to be the row itself.
    func testRowIDIsNotTheBareChannelID() {
        XCTAssertNotEqual(AppState.sidebarRowID("c1"), "c1")
    }
}
