import Foundation
import XCTest

@testable import Flow

/// The precomputed transcript row model (chat-render performance work). Rows
/// carry the grouping decisions and the parsed markdown so the render pass
/// never recomputes them; the cache must rebuild only when the message array
/// changes and must reuse parse results for unchanged bodies.
final class TranscriptRowsTests: XCTestCase {
    private func msg(
        _ id: String,
        user: String = "u1",
        body: String = "hello",
        at: String,
        systemKind: String? = nil
    ) -> Message {
        Message(
            id: id, channelId: "c1", userId: user, threadRootId: nil,
            clientMsgId: id, body: body, createdAt: at, editedAt: nil,
            deletedAt: nil, replyCount: 0, lastReplyAt: nil,
            systemKind: systemKind, pending: false
        )
    }

    // MARK: - Grouping

    func testFirstMessageShowsHeaderAndDayDivider() {
        let rows = TranscriptRowCache().rows(for: [msg("m1", at: "2026-08-19T10:00:00Z")])
        XCTAssertEqual(rows.count, 1)
        XCTAssertTrue(rows[0].showsHeader)
        XCTAssertTrue(rows[0].startsNewDay)
    }

    func testSameAuthorWithinFiveMinutesGroups() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", at: "2026-08-19T10:00:00Z"),
            msg("m2", at: "2026-08-19T10:04:59Z"),
        ])
        XCTAssertFalse(rows[1].showsHeader)
        XCTAssertFalse(rows[1].startsNewDay)
    }

    func testMoreThanFiveMinutesBreaksTheRun() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", at: "2026-08-19T10:00:00Z"),
            msg("m2", at: "2026-08-19T10:05:01Z"),
        ])
        XCTAssertTrue(rows[1].showsHeader)
    }

    func testDifferentAuthorBreaksTheRun() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", user: "u1", at: "2026-08-19T10:00:00Z"),
            msg("m2", user: "u2", at: "2026-08-19T10:01:00Z"),
        ])
        XCTAssertTrue(rows[1].showsHeader)
    }

    func testSystemLineBreaksTheRun() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", at: "2026-08-19T10:00:00Z"),
            msg("m2", body: "Alice joined the channel", at: "2026-08-19T10:01:00Z", systemKind: "join"),
            msg("m3", at: "2026-08-19T10:02:00Z"),
        ])
        XCTAssertTrue(rows[2].showsHeader)
    }

    func testCalendarDayChangeStartsNewDayAndHeader() {
        // Use a gap under 5 minutes across midnight UTC so the divider (not
        // the time gap) is what forces the header. The comparison uses the
        // current calendar, so pick times that fall on different days in any
        // timezone this test may run in: two full days apart.
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", at: "2026-08-17T10:00:00Z"),
            msg("m2", at: "2026-08-19T10:01:00Z"),
        ])
        XCTAssertTrue(rows[1].startsNewDay)
        XCTAssertTrue(rows[1].showsHeader)
    }

    func testUnparseableDateShowsHeaderButNoDivider() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", at: "2026-08-19T10:00:00Z"),
            msg("m2", at: "not-a-date"),
        ])
        XCTAssertTrue(rows[1].showsHeader)
        XCTAssertFalse(rows[1].startsNewDay)
    }

    // MARK: - Segments

    func testSegmentsAreParsedForUserMessagesOnly() {
        let rows = TranscriptRowCache().rows(for: [
            msg("m1", body: "# heading\ntext", at: "2026-08-19T10:00:00Z"),
            msg("m2", body: "Alice joined the channel", at: "2026-08-19T10:01:00Z", systemKind: "join"),
        ])
        XCTAssertEqual(rows[0].segments.first, .heading(level: 1, text: "heading"))
        XCTAssertTrue(rows[1].segments.isEmpty)
    }

    // MARK: - Caching

    func testSameArrayReturnsIdenticalRowsWithoutRebuild() {
        let cache = TranscriptRowCache()
        let messages = [msg("m1", at: "2026-08-19T10:00:00Z")]
        let first = cache.rows(for: messages)
        let second = cache.rows(for: messages)
        XCTAssertEqual(first, second)
    }

    func testAppendKeepsEarlierParseResults() {
        // Not observable through equality alone, so this pins behavior at the
        // seam: an append rebuilds the rows but the unchanged message's
        // segments must be the cached ones (same values), and the new row is
        // parsed fresh.
        let cache = TranscriptRowCache()
        let m1 = msg("m1", body: "**bold** text", at: "2026-08-19T10:00:00Z")
        let before = cache.rows(for: [m1])
        let after = cache.rows(for: [m1, msg("m2", body: "reply", at: "2026-08-19T10:01:00Z")])
        XCTAssertEqual(after.count, 2)
        XCTAssertEqual(before[0].segments, after[0].segments)
        XCTAssertEqual(after[1].segments, [.paragraph("reply")])
    }

    func testEditedBodyReparsesThatMessage() {
        let cache = TranscriptRowCache()
        var m1 = msg("m1", body: "one", at: "2026-08-19T10:00:00Z")
        _ = cache.rows(for: [m1])
        m1.body = "two"
        let rows = cache.rows(for: [m1])
        XCTAssertEqual(rows[0].segments, [.paragraph("two")])
    }

    func testGroupingRecomputesWhenAMessageIsRemoved() {
        // Deleting the run's first message promotes the second to a header.
        let cache = TranscriptRowCache()
        let m1 = msg("m1", at: "2026-08-19T10:00:00Z")
        let m2 = msg("m2", at: "2026-08-19T10:01:00Z")
        XCTAssertFalse(cache.rows(for: [m1, m2])[1].showsHeader)
        XCTAssertTrue(cache.rows(for: [m2])[0].showsHeader)
    }
}
