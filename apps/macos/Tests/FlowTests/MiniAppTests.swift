import Foundation
import XCTest

@testable import Flow

/// Mini apps (docs/design/MINI_APPS.md, issue #372): the mint-before-open
/// decision for the artifact panel's mini-browser, and the co-browse guard that
/// keeps a minted token out of the shared url.
///
/// Attaching the token is covered by `AppTokenTests` — that half is shared with
/// iOS. These are the parts worth pinning down here, because they are the parts
/// that are invisible when they go wrong: a plain link must behave exactly as it
/// did before mini apps existed, an app must never be loaded *without* a token,
/// and a tokened url must never escape into the co-browsed artifact url.
final class MiniAppTests: XCTestCase {
    private let token = "eyJ2IjoxfQ.c2ln"

    // MARK: - plan

    func testPlainLinkLoadsDirectlyWithNoMint() {
        XCTAssertEqual(
            MiniApp.plan(url: "https://example.com/page", isApp: false),
            .load("https://example.com/page")
        )
    }

    func testAppMintsBeforeLoading() {
        XCTAssertEqual(MiniApp.plan(url: "https://tunnel.example/", isApp: true), .mint)
    }

    func testEmptyUrlIsIdleWhetherOrNotItIsAnApp() {
        XCTAssertEqual(MiniApp.plan(url: "", isApp: false), .idle)
        // An app with no url must not mint: there is nothing to open, and a mint
        // would be a pointless membership check against the server.
        XCTAssertEqual(MiniApp.plan(url: "", isApp: true), .idle)
        XCTAssertEqual(MiniApp.plan(url: "", isApp: true, hasAppSession: true), .idle)
    }

    /// The regression that cost a live run: an app mints once per *open*. Once
    /// the guard's session cookie is set, a co-browse hop is an ordinary load.
    /// Re-minting here spends a token per hop and reloads the app from scratch.
    func testAppWithALiveSessionFollowsTheUrlWithoutMintingAgain() {
        XCTAssertEqual(
            MiniApp.plan(url: "https://tunnel.example/board", isApp: true, hasAppSession: true),
            .load("https://tunnel.example/board")
        )
    }

    func testAppMintsAgainWhenTheSessionIsNotOurs() {
        // A different artifact, or an explicit reload, is a new open — the
        // caller says so by passing `hasAppSession: false`, and it must mint.
        XCTAssertEqual(
            MiniApp.plan(url: "https://tunnel.example/board", isApp: true, hasAppSession: false),
            .mint
        )
    }

    // MARK: - isMemberNavigation

    /// The guard's 302 lands the web view on a url we never asked for. It is
    /// still our load, and broadcasting it re-points the artifact — which comes
    /// back as a url change and mints a second token.
    func testOwnLoadIsNotAMemberNavigationEvenWhenARedirectMovedIt() {
        let asked = "https://tunnel.example/?flow_token=\(token)"
        XCTAssertFalse(
            MiniApp.isMemberNavigation(
                committed: "https://tunnel.example/", isOwnLoad: true, lastLoaded: asked
            )
        )
    }

    func testAClickInsideTheAppIsAMemberNavigation() {
        XCTAssertTrue(
            MiniApp.isMemberNavigation(
                committed: "https://tunnel.example/board/7",
                isOwnLoad: false,
                lastLoaded: "https://tunnel.example/"
            )
        )
    }

    func testCommittingTheUrlWeAlreadyShowIsNotANavigation() {
        XCTAssertFalse(
            MiniApp.isMemberNavigation(
                committed: "https://example.com/page",
                isOwnLoad: false,
                lastLoaded: "https://example.com/page"
            )
        )
    }

    /// The pre-existing echo this also settles: the server normalises a bare
    /// host to a trailing slash, so the panel's own opening load committed a url
    /// one character off the one it asked for and re-pointed the artifact.
    func testTrailingSlashNormalisationOfOurOwnLoadIsNotBroadcast() {
        XCTAssertFalse(
            MiniApp.isMemberNavigation(
                committed: "https://example.com/", isOwnLoad: true, lastLoaded: "https://example.com"
            )
        )
    }

    // MARK: - carriesToken

    func testCarriesTokenRecognisesATokenedUrl() {
        let loaded = withAppToken("https://tunnel.example/", token: token)
        XCTAssertTrue(MiniApp.carriesToken(loaded!.absoluteString))
        XCTAssertTrue(MiniApp.carriesToken("https://tunnel.example/x?a=1&flow_token=\(token)&b=2"))
    }

    func testCarriesTokenIgnoresACleanUrl() {
        XCTAssertFalse(MiniApp.carriesToken("https://tunnel.example/"))
        XCTAssertFalse(MiniApp.carriesToken("https://tunnel.example/?view=grid"))
        XCTAssertFalse(MiniApp.carriesToken(""))
    }

    func testCarriesTokenIsNotFooledByALookalikeParameter() {
        // A different parameter that merely *contains* the name is not a token —
        // suppressing co-browse for it would silently break a legitimate page.
        XCTAssertFalse(MiniApp.carriesToken("https://tunnel.example/?my_flow_tokens=3"))
    }

    /// The round trip that matters for co-browse: what we hand the web view is
    /// recognisable as tokened, so the navigation delegate can refuse to
    /// broadcast it, while the artifact's own url stays clean and shareable.
    func testTokenedUrlIsRecognisableSoItIsNeverBroadcast() {
        let shared = "https://tunnel.example/board?view=grid"
        let loaded = withAppToken(shared, token: token)
        XCTAssertNotNil(loaded)
        XCTAssertTrue(MiniApp.carriesToken(loaded!.absoluteString))
        XCTAssertFalse(MiniApp.carriesToken(shared))
    }
}
