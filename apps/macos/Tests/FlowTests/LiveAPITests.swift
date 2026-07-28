import Foundation
import XCTest

@testable import Flow

/// Integration smoke test against the live local backend at 127.0.0.1:8787.
/// Verifies that APIClient decoding matches the server's actual JSON shapes.
/// Creates throwaway accounts (timestamped emails).
final class LiveAPITests: XCTestCase {
    private let baseURL = URL(string: "http://127.0.0.1:8787")!

    func testAuthWorkspaceChannelMessageFlow() async throws {
        let api = APIClient(baseURL: baseURL)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let email = "smoke\(stamp)@test.local"

        // Register
        let reg: AuthResponse = try await api.post(
            "/v1/auth/register",
            body: RegisterBody(email: email, password: "password123", displayName: "Smoke Test")
        )
        XCTAssertFalse(reg.token.isEmpty)
        XCTAssertEqual(reg.user.email, email)
        await api.setToken(reg.token)

        // Me
        let me: User = try await api.get("/v1/me")
        XCTAssertEqual(me.id, reg.user.id)

        // Login again
        let login: AuthResponse = try await api.post(
            "/v1/auth/login",
            body: LoginBody(email: email, password: "password123")
        )
        XCTAssertEqual(login.user.id, me.id)

        // Create workspace (auto-creates #general)
        let ws: Workspace = try await api.post(
            "/v1/workspaces",
            body: CreateWorkspaceBody(name: "Smoke WS", slug: "smoke-\(stamp)")
        )
        XCTAssertEqual(ws.role, "owner")

        // My workspaces
        let myWs: WorkspacesResponse = try await api.get("/v1/me/workspaces")
        XCTAssertTrue(myWs.workspaces.contains { $0.id == ws.id })

        // Channels
        let chans: ChannelsResponse = try await api.get("/v1/workspaces/\(ws.id)/channels")
        guard let general = chans.channels.first(where: { $0.name == "general" }) else {
            XCTFail("no #general channel")
            return
        }
        XCTAssertTrue(general.isMember)

        // Members
        let members: MembersResponse = try await api.get("/v1/workspaces/\(ws.id)/members")
        XCTAssertTrue(members.members.contains { $0.userId == me.id })

        // Send message (idempotent on clientMsgId)
        let clientMsgId = UUID().uuidString.lowercased()
        let sent: Message = try await api.post(
            "/v1/channels/\(general.id)/messages",
            body: SendMessageBody(clientMsgId: clientMsgId, body: "hello *smoke*", threadRootId: nil)
        )
        XCTAssertEqual(sent.clientMsgId, clientMsgId)
        XCTAssertNil(sent.threadRootId)

        // List messages
        let msgs: MessagesResponse = try await api.get(
            "/v1/channels/\(general.id)/messages",
            query: [URLQueryItem(name: "limit", value: "10")]
        )
        XCTAssertTrue(msgs.messages.contains { $0.id == sent.id })

        // Thread reply + thread fetch
        let reply: Message = try await api.post(
            "/v1/channels/\(general.id)/messages",
            body: SendMessageBody(
                clientMsgId: UUID().uuidString.lowercased(),
                body: "a reply",
                threadRootId: sent.id
            )
        )
        XCTAssertEqual(reply.threadRootId, sent.id)
        let thread: ThreadResponse = try await api.get("/v1/messages/\(sent.id)/thread")
        XCTAssertEqual(thread.root.id, sent.id)
        XCTAssertTrue(thread.messages.contains { $0.id == reply.id })

        // Edit + delete
        let edited: Message = try await api.patch(
            "/v1/messages/\(sent.id)",
            body: EditMessageBody(body: "edited body")
        )
        XCTAssertNotNil(edited.editedAt)
        let deleted: OkResponse = try await api.delete("/v1/messages/\(reply.id)")
        XCTAssertTrue(deleted.ok)

        // Mark read
        let read: OkResponse = try await api.post(
            "/v1/channels/\(general.id)/read",
            body: ReadBody(lastReadMsgId: sent.id)
        )
        XCTAssertTrue(read.ok)

        // Invite
        let invite: InviteResponse = try await api.post(
            "/v1/workspaces/\(ws.id)/invites",
            body: CreateInviteBody(email: "invitee\(stamp)@test.local")
        )
        XCTAssertTrue(invite.inviteUrl.hasPrefix("flow://invite/"))

        // Error envelope decoding
        do {
            let _: User = try await api.get("/v1/workspaces/\(UUID().uuidString)")
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertGreaterThanOrEqual(e.status, 400)
            XCTAssertFalse(e.code.isEmpty)
        }
    }

    /// A session that dies while the app is running must be *noticed*, not just
    /// thrown. Before the handler existed, the 401 surfaced as the server's raw
    /// message in whatever sheet made the call ("Couldn't paste image: invalid
    /// or expired token") while the app went on looking signed in.
    func testUnauthorizedHandlerFiresOnceForADeadToken() async throws {
        let api = APIClient(baseURL: baseURL)
        let fired = Counter()
        await api.setUnauthorizedHandler { await fired.bump() }
        await api.setToken("not-a-real-session-token")

        for _ in 0..<3 {
            do {
                let _: User = try await api.get("/v1/me")
                XCTFail("expected 401")
            } catch let e as APIError {
                XCTAssertEqual(e.status, 401)
            }
        }
        // Once per session, however many requests fail together.
        let count = await fired.value
        XCTAssertEqual(count, 1)

        // A new token arms it again — signing back in must not be permanently
        // deaf to a later expiry.
        await api.setToken("still-not-a-real-token")
        do {
            let _: User = try await api.get("/v1/me")
            XCTFail("expected 401")
        } catch let e as APIError {
            XCTAssertEqual(e.status, 401)
        }
        let after = await fired.value
        XCTAssertEqual(after, 2)
    }
}

private actor Counter {
    private(set) var value = 0
    func bump() { value += 1 }
}
