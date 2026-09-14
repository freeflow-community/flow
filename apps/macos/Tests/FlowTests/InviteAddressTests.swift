import XCTest

@testable import Flow

// The invite sheet takes a paste, not a single address (#578). Two things have
// to hold: whatever separator the admin's mail client used has to work, and a
// malformed address has to survive the trip to the server — the server answers
// per address, so a typo that vanished in the client would be a typo nobody
// ever learns about.
final class InviteAddressTests: XCTestCase {
    func testSingleAddressIsUnchanged() {
        XCTAssertEqual(InviteAddresses.parse("a@example.com"), ["a@example.com"])
    }

    func testSplitsOnCommasSemicolonsSpacesAndNewlines() {
        XCTAssertEqual(
            InviteAddresses.parse("a@x.com, b@x.com;c@x.com d@x.com\ne@x.com"),
            ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]
        )
    }

    func testDropsEmptyFragments() {
        XCTAssertEqual(InviteAddresses.parse("  a@x.com ,, , b@x.com,  "), ["a@x.com", "b@x.com"])
    }

    func testDedupesCaseInsensitivelyKeepingTheFirstSpelling() {
        XCTAssertEqual(InviteAddresses.parse("Bob@X.com, bob@x.com, carol@x.com"), ["Bob@X.com", "carol@x.com"])
    }

    func testKeepsAMalformedAddressForTheServerToJudge() {
        XCTAssertEqual(InviteAddresses.parse("nope, real@x.com"), ["nope", "real@x.com"])
    }

    func testWhitespaceOnlyIsEmpty() {
        XCTAssertEqual(InviteAddresses.parse("   \n  "), [])
    }

    func testStatusDecodesLenientlyAndSaysSomethingDifferentForEach() throws {
        let json = """
        {"results":[
          {"email":"a@x.com","status":"sent","inviteUrl":"flow://invite/aaa"},
          {"email":"b@x.com","status":"resent","inviteUrl":"flow://invite/bbb"},
          {"email":"c@x.com","status":"already_member"},
          {"email":"nope","status":"invalid_email"},
          {"email":"d@x.com","status":"email_failed","inviteUrl":"flow://invite/ddd"},
          {"email":"e@x.com","status":"teleported"}
        ]}
        """
        let batch = try JSONDecoder().decode(InviteBatchResponse.self, from: Data(json.utf8))
        XCTAssertEqual(batch.results.map(\.status), [.sent, .resent, .alreadyMember, .invalidEmail, .emailFailed, .unknown])
        XCTAssertEqual(Set(batch.results.map(\.status.label)).count, batch.results.count)
        // Only the addresses nothing reached go back in the box for a retry.
        XCTAssertEqual(batch.results.filter { $0.status.isFailure }.map(\.email), ["nope", "d@x.com", "e@x.com"])
        XCTAssertEqual(batch.results.filter { $0.status.isDelivered }.map(\.email), ["a@x.com", "b@x.com"])
    }
}
