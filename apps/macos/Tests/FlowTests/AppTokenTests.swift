import XCTest

@testable import Flow

// Mini apps (docs/design/MINI_APPS.md): the pure half of "mint, then open" —
// attaching the minted token to the app's url without mangling it.
final class AppTokenTests: XCTestCase {
    func testAppendsTokenToAPlainUrl() {
        let u = withAppToken("https://app.example.com/", token: "tok123")
        XCTAssertEqual(u?.absoluteString, "https://app.example.com/?flow_token=tok123")
    }

    // An app url is free to carry its own query; the token joins it rather than
    // replacing it.
    func testPreservesAnExistingQuery() {
        let u = withAppToken("https://app.example.com/x?a=1&b=2", token: "tok123")
        XCTAssertEqual(u?.absoluteString, "https://app.example.com/x?a=1&b=2&flow_token=tok123")
    }

    func testPreservesTheFragment() {
        let u = withAppToken("https://app.example.com/x#frag", token: "tok123")
        XCTAssertEqual(u?.absoluteString, "https://app.example.com/x?flow_token=tok123#frag")
    }

    // Opening the same app twice must not accumulate tokens — the second mint
    // replaces the first rather than appending beside it.
    func testReplacesAStaleToken() {
        let u = withAppToken("https://app.example.com/?flow_token=old&a=1", token: "new")
        XCTAssertEqual(u?.absoluteString, "https://app.example.com/?a=1&flow_token=new")
    }

    func testPercentEncodesTheToken() {
        let u = withAppToken("https://app.example.com/", token: "a b+c/d")
        XCTAssertEqual(u?.query?.contains(" "), false)
        XCTAssertEqual(
            URLComponents(url: u!, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "flow_token" })?.value,
            "a b+c/d"
        )
    }

    // A url we can't attach a token to means an app we must not open: the
    // caller surfaces the error instead of loading a page the guard refuses.
    func testRejectsAUrlWithNoScheme() {
        XCTAssertNil(withAppToken("app.example.com", token: "tok"))
        XCTAssertNil(withAppToken("", token: "tok"))
    }
}
