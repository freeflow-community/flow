import XCTest

/// Ongoing agent-call acceptance without simulator microphone input. The
/// DEBUG transcript hook exercises the real sheet and persistent bar; all
/// screenshots are kept in the xcresult for PR and release QA.
final class AgentCallTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAgentCallMinimizesReopensAndEndsExplicitly() throws {
        let dm = try XCTUnwrap(
            ProcessInfo.processInfo.environment["FLOW_TEST_DM"],
            "set FLOW_TEST_DM to a one-to-one agent DM channel id"
        )
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": ProcessInfo.processInfo.environment["FLOW_TEST_SERVER"]
                ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": dm,
            "FLOW_DEBUG_AGENT_CALL_TRANSCRIPT": "Please summarize the latest work",
            "FLOW_DEBUG_AGENT_CALL_HOLD_TRANSCRIPT": "1",
        ]
        app.launch()

        let start = element(app, "agentCall.start")
        XCTAssertTrue(start.waitForExistence(timeout: 60))
        attach("01-agent-dm-call-entry")
        start.tap()

        let caption = element(app, "agentCall.caption")
        XCTAssertTrue(caption.waitForExistence(timeout: 15))
        XCTAssertTrue(caption.label.contains("Please summarize the latest work"))
        XCTAssertTrue(element(app, "agentCall.mute").exists)
        XCTAssertTrue(element(app, "agentCall.end").exists)
        attach("02-agent-call-listening")

        element(app, "agentCall.minimizeControl").tap()
        let bar = element(app, "agentCall.bar")
        XCTAssertTrue(bar.waitForExistence(timeout: 10))
        attach("03-agent-call-minimized")

        element(app, "agentCall.open").tap()
        XCTAssertTrue(element(app, "agentCall.end").waitForExistence(timeout: 10))
        attach("04-agent-call-reopened")
        element(app, "agentCall.end").tap()

        XCTAssertFalse(bar.waitForExistence(timeout: 2))
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        attach("05-agent-call-ended")
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
