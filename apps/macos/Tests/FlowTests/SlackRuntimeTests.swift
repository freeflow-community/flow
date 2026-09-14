import Foundation
import GRDB
import Testing
@testable import Flow

/// The sync engine routed through a provider backend (#546): a Slack
/// connection boots, lists, reads, sends, applies stream events and signs out
/// through the connector's normalized API, and never builds a Flow path. The
/// connector is a fake transport; the database is in memory.

private let rts1 = "1789171841.148649"
private let rts2 = "1789172009.709539"

private func runtimeMessageJSON(_ id: String, userId: String = "U1", threadRootId: String? = nil) -> String {
    let thread = threadRootId.map { "\"\($0)\"" } ?? "null"
    return """
    {"id":"\(id)","channelId":"C1","userId":"\(userId)","threadRootId":\(thread),"clientMsgId":"","body":"hello","createdAt":"2026-09-11T22:50:41.148Z",
     "editedAt":null,"deletedAt":null,"pinnedAt":null,"pinnedBy":null,"replyCount":0,"lastReplyAt":null,"systemKind":null,"scheduled":false,
     "replyParticipantUserIds":[],"reactions":[],"files":[],"unfurls":[],
     "provenance":{"provider":"slack","openUrl":"https://app.slack.com/client/T1/C1/p\(id.replacingOccurrences(of: ".", with: ""))","degraded":false,"subtype":null}}
    """
}

private final class RuntimeConnector: @unchecked Sendable {
    private let lock = NSLock()
    private var log: [(method: String, path: String, body: [String: Any]?)] = []
    var requests: [(method: String, path: String, body: [String: Any]?)] { lock.lock(); defer { lock.unlock() }; return log }
    var credentialPresent = true
    private func record(_ method: String, _ path: String, _ body: [String: Any]?) { lock.lock(); log.append((method, path, body)); lock.unlock() }

    func transport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        record(request.httpMethod ?? "GET", path, body)
        func reply(_ json: String, status: Int = 200) -> (Data, HTTPURLResponse) {
            (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: [:])!)
        }
        switch (request.httpMethod, path) {
        case ("GET", "/v1/connection"):
            return reply(#"{"identity":{"environment":"slack","enterpriseId":null,"teamId":"T1","userId":"U1"},"teamName":"Acme","userName":"alice","capabilities":{"identity":true,"sendAsUser":true,"readConversations":true,"readHistory":true,"liveUpdates":true},"grantStatus":"active","scopes":[]}"#)
        case ("GET", "/v1/workspace"):
            return reply(#"{"id":"T1","slug":"T1","name":"Acme","createdBy":"","createdAt":"","sidebarColor":"slate","avatarUrl":null,"googleSelfRegisterDomain":null,"role":"member"}"#)
        case ("GET", "/v1/conversations"):
            return reply(#"{"conversations":[{"id":"C1","workspaceId":"T1","name":"testing","kind":"standard","topic":"t","isPrivate":false,"createdBy":"U1","createdAt":"","archivedAt":null,"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,"unreadThreadRootIds":[],"notifyLevel":1,"parentId":null},{"id":"D1","workspaceId":"T1","name":null,"kind":"dm","topic":null,"isPrivate":true,"createdBy":"","createdAt":"","archivedAt":null,"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,"unreadThreadRootIds":[],"notifyLevel":1,"parentId":null,"memberIds":["U2","U1"]}]}"#)
        case ("GET", "/v1/members"):
            return reply(#"{"members":[{"userId":"U1","displayName":"alice","email":"","avatarUrl":null,"statusEmoji":"","statusText":"","title":"","isAgent":false,"isBot":false,"sponsorId":null,"privacyMode":false,"role":"admin","joinedAt":""},{"userId":"U2","displayName":"Bob","email":"","avatarUrl":null,"statusEmoji":"","statusText":"","title":"","isAgent":false,"isBot":false,"sponsorId":null,"privacyMode":false,"role":"member","joinedAt":""}]}"#)
        case ("GET", "/v1/history"):
            return reply(#"{"messages":[\#(runtimeMessageJSON(rts1)),\#(runtimeMessageJSON(rts2, threadRootId: rts1))],"cursor":"older","partial":true}"#)
        case ("POST", "/v1/messages"):
            let clientMsgId = body?["client_msg_id"] as? String ?? body?["clientMsgId"] as? String ?? ""
            let sent = runtimeMessageJSON("1700000000.000001").replacingOccurrences(of: "\"clientMsgId\":\"\"", with: "\"clientMsgId\":\"\(clientMsgId)\"")
            return reply(#"{"channel":"C1","ts":"1700000000.000001","userId":"U1","message":\#(sent)}"#)
        case ("GET", "/v1/stream"):
            return reply(#"{"events":[],"seq":0,"gap":false}"#)
        case ("POST", "/v1/read"):
            return reply(#"{"ok":true}"#)
        case ("DELETE", "/v1/session"):
            return reply(#"{"ok":true}"#)
        default:
            return reply(#"{"error":"not_found"}"#, status: 404)
        }
    }
}

private func makeRuntime(_ fake: RuntimeConnector) throws -> (SyncEngine, AppDatabase) {
    let db = try AppDatabase.inMemory()
    let dead = URL(string: "http://127.0.0.1:1")!
    let backend = SlackBackend(connectionId: "slack-T1-U1", origin: URL(string: "https://connector.test")!, teamId: "T1", userId: "U1", label: "Acme · alice",
                               granted: ["sendAsUser": true, "readConversations": true, "readHistory": true, "liveUpdates": true],
                               credential: { fake.credentialPresent ? "credential-1" : nil }, transport: fake.transport, autoPoll: false)
    let engine = SyncEngine(db: db, api: APIClient(baseURL: dead), socket: SocketClient(url: dead),
                            connectionId: "slack-T1-U1", scope: StorageScope(storageKey: "test-slack-\(UUID().uuidString)"), backend: backend)
    return (engine, db)
}

@Suite struct SlackRuntimeTests {
    @Test func bootsListsReadsAndSendsThroughTheConnectorOnly() async throws {
        let fake = RuntimeConnector()
        let (engine, db) = try makeRuntime(fake)
        await engine.bootstrap()
        #expect(await engine.currentUserId == "U1")
        await engine.selectWorkspace("T1") // what a window does when it shows the team
        let channelIds: [String] = try await db.reader.read { db in try String.fetchAll(db, sql: "SELECT id FROM channel ORDER BY id") }
        #expect(channelIds == ["C1", "D1"])
        let workspace: String? = try await db.reader.read { db in try String.fetchOne(db, sql: "SELECT name FROM workspace WHERE id = 'T1'") }
        #expect(workspace == "Acme")

        await engine.selectChannel("C1")
        let stored: [String] = try await db.reader.read { db in try String.fetchAll(db, sql: "SELECT id FROM message WHERE channelId = 'C1' ORDER BY id") }
        #expect(stored == [rts1, rts2], "Slack ts is the message id, verbatim")

        _ = await engine.sendMessage(channelId: "C1", body: "hi from the mac")
        let sent = fake.requests.first { $0.method == "POST" && $0.path == "/v1/messages" }
        #expect(sent != nil)
        let clientId = sent?.body?["client_msg_id"] as? String ?? sent?.body?["clientMsgId"] as? String
        #expect(clientId?.isEmpty == false, "the client id rides along for reconciliation")
        let pending: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM message WHERE pending = 1 OR failed = 1") ?? -1 }
        #expect(pending == 0)
        let confirmed: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM message WHERE id = '1700000000.000001'") ?? -1 }
        #expect(confirmed == 1)

        #expect(fake.requests.allSatisfy { $0.path.hasPrefix("/v1/") && !$0.path.contains("/channels/") && !$0.path.contains("/auth/") }, "no Flow route is ever built for a Slack team")
    }

    @Test func streamEventsPatchTheCacheAndDuplicatesAreAbsorbed() async throws {
        let fake = RuntimeConnector()
        let (engine, db) = try makeRuntime(fake)
        await engine.bootstrap()
        await engine.selectWorkspace("T1")
        let data = Data(runtimeMessageJSON("1789180000.000100", userId: "U2").utf8)
        let incoming = try JSONDecoder().decode(Message.self, from: data)
        await engine.apply(.messageCreated(incoming))
        await engine.apply(.messageCreated(incoming))
        let unread: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT unreadCount FROM channel WHERE id = 'C1'") ?? -1 }
        #expect(unread == 1, "a duplicate delivery bumps nothing")
        let count: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM message WHERE id = '1789180000.000100'") ?? -1 }
        #expect(count == 1)

        await engine.apply(.reactionChanged(channelId: "C1", messageId: "1789180000.000100", emoji: "✅", userId: "U1", added: true))
        let reacted: Message? = try await db.reader.read { db in try Message.fetchOne(db, key: "1789180000.000100") }
        #expect(reacted?.reactions.first?.emoji == "✅")
        #expect(reacted?.reactions.first?.userIds == ["U1"])

        await engine.apply(.messageDeleted(channelId: "C1", messageId: "1789180000.000100", threadRootId: nil))
        let gone: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM message WHERE id = '1789180000.000100'") ?? -1 }
        #expect(gone == 0, "a provider delete purges the row; there is no tombstone to keep")
    }

    @Test func signOutForgetsOnlyThisClientAndAMissingCredentialNeverBoots() async throws {
        let fake = RuntimeConnector()
        let (engine, db) = try makeRuntime(fake)
        await engine.bootstrap()
        #expect(await engine.currentUserId == "U1")
        _ = await engine.logout()
        #expect(fake.requests.contains { $0.method == "DELETE" && $0.path == "/v1/session" }, "disconnects this client only")
        #expect(!fake.requests.contains { $0.path == "/v1/grant" }, "never deletes the shared grant on sign-out")
        #expect(await engine.currentUserId == nil)
        let rows: Int = try await db.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM channel") ?? -1 }
        #expect(rows == 0)

        let cold = RuntimeConnector()
        cold.credentialPresent = false
        let (fresh, _) = try makeRuntime(cold)
        await fresh.bootstrap()
        #expect(await fresh.currentUserId == nil)
        #expect(cold.requests.isEmpty, "without a credential nothing is asked of the connector")
    }
}
