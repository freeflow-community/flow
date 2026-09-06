import XCTest

@testable import Flow

/// Side-panel keep-alive (#513): which link artifact's web view the panel holds
/// mounted while another tab shows, so toggling Thread <-> app doesn't reload the
/// page through the tunnel. Same rule as the web client's `nextKeepAlive`, and
/// these cases are the same cases — the two must not drift.
final class SidePanelKeepAliveTests: XCTestCase {
    private func artifact(_ id: String = "a-app", kind: String = "link") -> Artifact {
        Artifact(
            id: id, workspaceId: "w", channelId: "c1", kind: kind, fileId: nil,
            url: "https://board.example.com/", name: "Task Board", ownsFile: false,
            isApp: kind == "link", createdAt: "", updatedAt: "", file: nil
        )
    }

    private let held = WindowState.KeepAlive(channelId: "c1", artifactId: "a-app")

    func testHoldsALinkArtifactOnceSelected() {
        XCTAssertEqual(
            WindowState.nextKeepAlive(prev: nil, channelId: "c1", selected: artifact()), held
        )
    }

    /// The point of the fix: the Thread tab clears the artifact selection, and
    /// the frame has to survive that.
    func testKeepsHoldingWhileAnotherTabShows() {
        XCTAssertEqual(
            WindowState.nextKeepAlive(prev: held, channelId: "c1", selected: nil), held
        )
    }

    func testKeepsTheAppFrameWhenAFileArtifactIsOpenedAlongsideIt() {
        XCTAssertEqual(
            WindowState.nextKeepAlive(
                prev: held, channelId: "c1", selected: artifact("a-png", kind: "file")
            ),
            held
        )
    }

    func testHoldsOnlyTheMostRecentLink() {
        XCTAssertEqual(
            WindowState.nextKeepAlive(prev: held, channelId: "c1", selected: artifact("a-other")),
            WindowState.KeepAlive(channelId: "c1", artifactId: "a-other")
        )
    }

    func testDropsTheFrameWhenTheChannelChanges() {
        XCTAssertNil(WindowState.nextKeepAlive(prev: held, channelId: "c2", selected: nil))
        XCTAssertNil(WindowState.nextKeepAlive(prev: held, channelId: nil, selected: nil))
    }

    func testDoesNotHoldAFileArtifact() {
        XCTAssertNil(
            WindowState.nextKeepAlive(
                prev: nil, channelId: "c1", selected: artifact("a-png", kind: "file")
            )
        )
    }

    /// Closing the panel is what drops a held frame — the web client gets this
    /// for free by unmounting the panel; here it is explicit.
    @MainActor
    func testClosingThePanelDropsTheHeldFrame() {
        let app = AppState()
        let win = WindowState(app: app)
        win.selectArtifact("a-app")
        win.closeSidePanel()
        XCTAssertNil(win.keepAlive)
    }
}
