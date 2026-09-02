import Foundation
import XCTest

@testable import Flow

/// Integration smoke test against a live local backend. Verifies that
/// APIClient decoding matches the server's actual JSON shapes. Creates
/// throwaway accounts (timestamped emails).
///
/// The server address is `FLOW_TEST_SERVER_URL` (falling back to the app's own
/// `FLOW_SERVER_URL`), defaulting to `http://127.0.0.1:8787` — unchanged for
/// anyone whose dev server is on the default port. It is configurable because
/// 8787 is not always Flow's: on a machine where another app holds it, every
/// `swift test` run failed here on a stranger's 404 (#455, #459). `pnpm qa:up`
/// prints a ready-made export line for a scratch server on a free port.
final class LiveAPITests: XCTestCase {
    private let baseURL = LiveAPITests.serverURL

    static let serverURL: URL = {
        let env = ProcessInfo.processInfo.environment
        let raw = env["FLOW_TEST_SERVER_URL"] ?? env["FLOW_SERVER_URL"] ?? ""
        return URL(string: raw.trimmingCharacters(in: .whitespaces)) ?? defaultServerURL
    }()

    static let defaultServerURL = URL(string: "http://127.0.0.1:8787")!

    /// Skip rather than fail when nothing Flow-shaped is listening. A live
    /// integration test has nothing to say about the code when the thing it
    /// integrates with is absent — and "absent" here includes an unrelated
    /// server squatting the port, which is why the probe insists on Flow's own
    /// 401 rather than merely on a socket that accepts.
    override func setUp() async throws {
        try await super.setUp()
        var req = URLRequest(url: baseURL.appendingPathComponent("v1/me"))
        req.timeoutInterval = 3
        guard
            let (_, res) = try? await URLSession.shared.data(for: req),
            (res as? HTTPURLResponse)?.statusCode == 401
        else {
            throw XCTSkip(
                "no Flow server at \(baseURL.absoluteString) — start one "
                    + "(`pnpm qa:up`, then export the FLOW_TEST_SERVER_URL it prints)"
            )
        }
    }

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
