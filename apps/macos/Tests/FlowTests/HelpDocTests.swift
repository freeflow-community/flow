import Foundation
import XCTest

@testable import Flow

/// The built-in help viewer (#384). Two things are worth pinning down here,
/// because both are invisible until a doc looks wrong: the viewer opens on a
/// topic that actually exists, and doc prose reflows to the pane instead of
/// keeping the source file's 80-column line breaks.
final class HelpDocTests: XCTestCase {
    private func topic(_ slug: String, _ order: Int) -> HelpTopic {
        HelpTopic(slug: slug, title: slug.capitalized, order: order)
    }

    // MARK: - opening topic

    func testOpensOnHome() {
        let topics = [topic("home", 0), topic("workspaces", 1), topic("agents", 3)]
        XCTAssertEqual(HelpDoc.openingSlug(topics), "home")
    }

    /// Home is a file on the server like any other. If a deployment's docs
    /// directory hasn't got one, open the first topic rather than a 404.
    func testFallsBackToFirstTopicWithoutHome() {
        XCTAssertEqual(HelpDoc.openingSlug([topic("agents", 3), topic("workspaces", 1)]), "agents")
    }

    func testNoTopicsHasNoOpeningSlug() {
        XCTAssertNil(HelpDoc.openingSlug([]))
    }

    // MARK: - blocks

    /// The whole point of the reflow: a paragraph wrapped at ~80 columns in the
    /// markdown file is one paragraph, not three lines of fixed-width text.
    func testParagraphSourceLinesFoldIntoOneLine() {
        let md = """
        Flow is a chat workspace where people and AI agents work side by
        side. Agents are real members: they have names and avatars, and they
        join channels.
        """
        guard case let .paragraph(text)? = HelpDoc.blocks(md).first else {
            return XCTFail("expected a paragraph")
        }
        XCTAssertFalse(text.contains("\n"))
        XCTAssertTrue(text.hasPrefix("Flow is a chat workspace where people and AI agents work side by side."))
    }

    /// Two paragraphs separated by a blank line stay two paragraphs. The
    /// message grammar keeps a prose run in one segment (a message body draws
    /// the blank line itself), so folding without splitting first ran the
    /// sections of a help page together — caught in the app, not in review.
    func testBlankLineStillSeparatesParagraphs() {
        let md = """
        Ask your agent to build one. The agent writes the app, runs it, and
        pins it in the channel.

        The app is hosted by the agent itself.
        """
        XCTAssertEqual(
            HelpDoc.blocks(md),
            [
                .paragraph("Ask your agent to build one. The agent writes the app, runs it, and pins it in the channel."),
                .paragraph("The app is hosted by the agent itself."),
            ]
        )
    }

    /// Everything else is the message grammar untouched — headings, bullets and
    /// numbered lists all survive, so a doc renders like the rest of the app.
    func testHeadingsAndListsSurvive() {
        let md = """
        # Agents

        An agent is an AI teammate.

        - **@-mention it** in a channel.
        - **DM it** for work that doesn't need an audience.

        1. An invite link
        2. An email invite
        """
        let blocks = HelpDoc.blocks(md)
        guard blocks.count == 4 else { return XCTFail("expected 4 blocks, got \(blocks.count)") }
        XCTAssertEqual(blocks[0], .heading(level: 1, text: "Agents"))
        XCTAssertEqual(blocks[1], .paragraph("An agent is an AI teammate."))
        XCTAssertEqual(
            blocks[2],
            .ulist(items: ["**@-mention it** in a channel.", "**DM it** for work that doesn't need an audience."])
        )
        XCTAssertEqual(blocks[3], .olist(start: 1, items: ["An invite link", "An email invite"]))
    }

    /// Code blocks keep their line breaks — reflow is for prose only.
    func testCodeBlockKeepsItsLines() {
        let md = """
        ```
        GET /v1/help/topics
        GET /v1/help/pages/:slug
        ```
        """
        XCTAssertEqual(
            HelpDoc.blocks(md),
            [.code("GET /v1/help/topics\nGET /v1/help/pages/:slug")]
        )
    }
}
