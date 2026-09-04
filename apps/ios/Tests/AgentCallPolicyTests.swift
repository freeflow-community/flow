import XCTest
@testable import Flow

final class AgentCallPolicyTests: XCTestCase {
    func testEligibilityRequiresAOneToOneAgentDM() {
        let me = "00000000-0000-0000-0000-000000000001"
        let agent = "00000000-0000-0000-0000-000000000002"
        let human = "00000000-0000-0000-0000-000000000003"

        XCTAssertEqual(
            AgentCallEligibility.participantId(
                channelKind: "dm",
                memberIds: [me, agent],
                currentUserId: me,
                agentIds: [agent]
            ),
            agent
        )
        XCTAssertNil(AgentCallEligibility.participantId(
            channelKind: "dm",
            memberIds: [me, human],
            currentUserId: me,
            agentIds: [agent]
        ))
        XCTAssertNil(AgentCallEligibility.participantId(
            channelKind: "group_dm",
            memberIds: [me, agent, human],
            currentUserId: me,
            agentIds: [agent]
        ))
    }

    func testReplyPolicySkipsProgressFailedAndScheduledRows() {
        let agent = "00000000-0000-0000-0000-000000000002"
        let after = "01900000-0000-7000-8000-000000000010"
        let rows = [
            message(
                id: "01900000-0000-7000-8000-000000000011",
                userId: agent,
                body: "🤖 *thinking…* — checking files"
            ),
            message(
                id: "01900000-0000-7000-8000-000000000012",
                userId: agent,
                body: "A failed local echo",
                failed: true
            ),
            message(
                id: "01900000-0000-7000-8000-000000000013",
                userId: agent,
                body: "A scheduled aside",
                scheduled: true
            ),
            message(
                id: "01900000-0000-7000-8000-000000000014",
                userId: agent,
                body: "The finished answer"
            ),
        ]

        XCTAssertEqual(
            AgentCallReplyPolicy.response(in: rows, after: after, agentUserId: agent)?.body,
            "The finished answer"
        )
    }

    func testReplyPolicyChoosesFirstDurableAnswerAfterTurn() {
        let agent = "00000000-0000-0000-0000-000000000002"
        let rows = [
            message(id: "01900000-0000-7000-8000-000000000030", userId: agent, body: "Later"),
            message(id: "01900000-0000-7000-8000-000000000020", userId: agent, body: "First"),
            message(id: "01900000-0000-7000-8000-000000000005", userId: agent, body: "Old"),
        ]

        XCTAssertEqual(
            AgentCallReplyPolicy.response(
                in: rows,
                after: "01900000-0000-7000-8000-000000000010",
                agentUserId: agent
            )?.body,
            "First"
        )
    }

    func testSpokenTextRemovesMarkdownLinksAndCode() {
        XCTAssertEqual(
            AgentSpokenText.make(from: "**Done.** [Open the result](https://example.com)."),
            "Done. Open the result."
        )
        XCTAssertEqual(
            AgentSpokenText.make(from: "```swift\nlet value = 1\n```"),
            "I included the code in the chat."
        )
    }

    func testSpokenTextBoundsLongReplies() {
        let spoken = AgentSpokenText.make(from: String(repeating: "a", count: 1_300))
        XCTAssertTrue(spoken.hasSuffix("The rest is in the chat."))
        XCTAssertLessThan(spoken.count, 1_300)
    }

    private func message(
        id: String,
        userId: String,
        body: String,
        failed: Bool = false,
        scheduled: Bool = false
    ) -> Message {
        Message(
            id: id,
            channelId: "00000000-0000-0000-0000-000000000010",
            userId: userId,
            threadRootId: nil,
            clientMsgId: "00000000-0000-0000-0000-000000000020",
            body: body,
            createdAt: "2026-09-03T12:00:00Z",
            editedAt: nil,
            deletedAt: nil,
            replyCount: 0,
            lastReplyAt: nil,
            scheduled: scheduled,
            pending: false,
            failed: failed
        )
    }
}
