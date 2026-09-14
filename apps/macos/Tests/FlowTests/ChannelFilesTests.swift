import Foundation
import XCTest

@testable import Flow

/// Channel Files list (#347 macOS, #348 iOS): the wire shape decodes into the
/// `FileAttachment` every existing preview/download path already speaks, the
/// row labels read the way the design does, and the Files tab shares the side
/// panel with the thread and artifact tabs without any two being active at once.
final class ChannelFilesTests: XCTestCase {
    private let page = """
    {
      "files": [
        {
          "id": "11111111-1111-7111-8111-111111111111",
          "name": "Q3-roadmap.pdf",
          "mimeType": "application/pdf",
          "sizeBytes": 2516582,
          "width": null,
          "height": null,
          "hasThumb": false,
          "userId": "22222222-2222-7222-8222-222222222222",
          "uploaderName": "Scott",
          "createdAt": "2026-08-24T10:00:00.000Z",
          "messageId": "33333333-3333-7333-8333-333333333333"
        }
      ],
      "total": 42,
      "nextCursor": "b3BhcXVl"
    }
    """

    func testDecodesAPageIntoFileAttachments() throws {
        let decoded = try JSONDecoder().decode(ChannelFilePage.self, from: Data(page.utf8))
        XCTAssertEqual(decoded.total, 42)
        XCTAssertEqual(decoded.nextCursor, "b3BhcXVl")
        let row = try XCTUnwrap(decoded.files.first)
        XCTAssertEqual(row.file.name, "Q3-roadmap.pdf")
        XCTAssertEqual(row.file.sizeBytes, 2_516_582)
        XCTAssertTrue(row.file.isPDF)
        XCTAssertFalse(row.file.hasThumb)
        XCTAssertEqual(row.uploaderName, "Scott")
        XCTAssertEqual(row.messageId, "33333333-3333-7333-8333-333333333333")
        XCTAssertEqual(row.typeLabel, "pdf")
        // the same file shared in two messages is two rows
        XCTAssertEqual(row.id, "33333333-3333-7333-8333-333333333333-11111111-1111-7111-8111-111111111111")
    }

    func testDateLabelUsesTheSharedTimestamp() throws {
        let decoded = try JSONDecoder().decode(ChannelFilePage.self, from: Data(page.utf8))
        let row = try XCTUnwrap(decoded.files.first)
        XCTAssertTrue(row.dateLabel.hasPrefix("Aug 2"), "unexpected label: \(row.dateLabel)")
    }

    func testSortOptionsAreTheFourLinksInOrder() {
        XCTAssertEqual(
            ChannelFileSort.allCases.map(\.label),
            ["Newest", "Oldest", "Name", "Size"]
        )
        XCTAssertEqual(ChannelFileSort.newest.rawValue, "newest")
    }

    func testDurationLabel() {
        XCTAssertEqual(VideoDuration.label(42), "0:42")
        XCTAssertEqual(VideoDuration.label(65), "1:05")
        XCTAssertEqual(VideoDuration.label(3723), "1:02:03")
    }

    /// The Files tab is a tab: opening it hides the artifact body, and opening
    /// an artifact (or the thread) hides Files. Exactly one body shows.
    @MainActor
    func testFilesTabIsMutuallyExclusiveWithTheOtherTabs() {
        let app = AppState()
        let win = WindowState(app: app)

        win.openFiles(true)
        XCTAssertTrue(win.filesOpen)

        win.selectArtifact("artifact-1")
        XCTAssertFalse(win.filesOpen, "opening an artifact must take the panel from Files")

        win.openFiles(true)
        XCTAssertNil(win.selectedArtifactId, "opening Files must clear the active artifact")

        win.showThread()
        XCTAssertFalse(win.filesOpen, "switching to the Thread tab must leave Files")

        win.openFiles(true)
        win.closeSidePanel()
        XCTAssertFalse(win.filesOpen, "closing the panel closes Files with it")
    }

    /// Files are per-channel: the tab must not carry one channel's list over
    /// another channel's conversation.
    @MainActor
    func testChangingChannelClosesTheFilesTab() {
        let app = AppState()
        let win = WindowState(app: app)
        win.selectChannel("channel-a")
        win.openFiles(true)
        win.selectChannel("channel-b")
        XCTAssertFalse(win.filesOpen)
    }
}
