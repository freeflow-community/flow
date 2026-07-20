import XCTest

@testable import Flow

// ui_nits: emoji search matches substrings of the shortcode, prefix hits first.
final class EmojiCatalogTests: XCTestCase {
    func testMatchesSubstringsNotJustPrefixes() {
        let codes = EmojiCatalog.matches(query: "heart", limit: 20).map(\.code)
        XCTAssertTrue(codes.contains("heart")) // prefix hit
        XCTAssertTrue(codes.contains("broken_heart")) // substring hit
        XCTAssertTrue(codes.contains("green_heart"))
    }

    func testPrefixMatchesRankFirst() {
        let codes = EmojiCatalog.matches(query: "heart", limit: 20).map(\.code)
        XCTAssertEqual(codes.first, "heart")
        if let firstSubstring = codes.firstIndex(where: { !$0.hasPrefix("heart") }) {
            XCTAssertFalse(codes[firstSubstring...].contains { $0.hasPrefix("heart") })
        }
    }

    func testMidNameOnlyHitFound() {
        let codes = EmojiCatalog.matches(query: "check", limit: 10).map(\.code)
        XCTAssertTrue(codes.contains("white_check_mark"))
    }

    func testLimitAndEmptyQuery() {
        XCTAssertEqual(EmojiCatalog.matches(query: "a", limit: 3).count, 3)
        XCTAssertTrue(EmojiCatalog.matches(query: "").isEmpty)
    }
}
