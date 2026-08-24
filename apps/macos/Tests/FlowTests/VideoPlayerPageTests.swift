import Foundation
import XCTest

@testable import Flow

/// The wrapper page the native player loads (#318). What matters is that the
/// player ends up in a *sub*-frame of a page with a real https origin — a
/// top-level navigation to the embed URL is what YouTube answers with error
/// 153 — and that the only thing interpolated into the markup is the URL the
/// server built, escaped.
final class VideoPlayerPageTests: XCTestCase {
    private let playerSrc =
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0"

    func testEmbeddingOriginIsHTTPS() {
        XCTAssertEqual(VideoPlayerPage.embeddingOrigin.scheme, "https")
    }

    func testPageEmbedsThePlayerInAnIframe() {
        let html = VideoPlayerPage.html(playerSrc: playerSrc)
        XCTAssertTrue(html.contains("<iframe"), html)
        XCTAssertTrue(
            html.contains("src=\"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;playsinline=1&amp;rel=0\""),
            html
        )
    }

    /// Inline playback on iOS: without these the tap hands the whole screen to
    /// the system player.
    func testPageKeepsPlaybackInline() {
        let html = VideoPlayerPage.html(playerSrc: playerSrc)
        XCTAssertTrue(html.contains("playsinline=1"), html)
        XCTAssertTrue(html.contains("allow=\"autoplay;"), html)
        XCTAssertTrue(html.contains("allowfullscreen"), html)
    }

    func testAttributeEscaping() {
        XCTAssertEqual(
            VideoPlayerPage.escaped("a&b<c>d\"e'f"),
            "a&amp;b&lt;c&gt;d&quot;e&#39;f"
        )
    }

    /// A src that tried to break out of the attribute would be the only route
    /// from provider data into our markup, so it is closed here as well as on
    /// the server.
    func testHostileSrcCannotEscapeTheAttribute() {
        let html = VideoPlayerPage.html(
            playerSrc: "https://example.com/\"></iframe><script>alert(1)</script>"
        )
        XCTAssertFalse(html.contains("<script>"), html)
        XCTAssertEqual(html.components(separatedBy: "<iframe").count - 1, 1, html)
    }
}
