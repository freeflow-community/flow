import XCTest
@testable import Flow

final class MentionRenderingTests: XCTestCase {
    /// Slack bodies keep Slack's own `<@U…>` ids; they must render as names too.
    func testSlackUserIdMentionRendersName() {
        let body = "Happy birthday <@U08JDGF1EAY> !"
        let names = ["U08JDGF1EAY": "Dana"]
        XCTAssertEqual(MentionRendering.plainText(body, names: names), "Happy birthday @Dana !")
        let attributed = MentionRendering.attributed(body, names: names, currentUserId: nil)
        XCTAssertEqual(String(attributed.characters), "Happy birthday @Dana !")
    }

    func testFlowUuidMentionStillRendersName() {
        let id = "00000000-0000-0000-0000-0000000000ab"
        XCTAssertEqual(MentionRendering.plainText("hi <@\(id)>", names: [id: "Ada"]), "hi @Ada")
    }
}
