import Foundation
import Testing
@testable import Flow

/// The native Slack backend (#545): decoding of the connector's normalized
/// payloads, capability wording, rate-limit and scope errors, the event
/// stream, and the registry's Slack identity rules. No network: the transport
/// is a closure fed with the same shapes the connector's own tests assert.

private let ts1 = "1789171841.148649"
private let ts2 = "1789172009.709539"

private func messageJSON(_ id: String, threadRootId: String? = nil, editedAt: String? = nil) -> String {
    let thread = threadRootId.map { "\"\($0)\"" } ?? "null"
    let edited = editedAt.map { "\"\($0)\"" } ?? "null"
    return """
    {"id":"\(id)","channelId":"C1","userId":"U1","threadRootId":\(thread),"clientMsgId":"","body":"hello **bold**","createdAt":"2026-09-11T22:50:41.148Z",
     "editedAt":\(edited),"deletedAt":null,"pinnedAt":null,"pinnedBy":null,"replyCount":0,"lastReplyAt":null,"systemKind":null,"scheduled":false,
     "replyParticipantUserIds":[],"reactions":[{"emoji":"✅","count":1,"userIds":["U2"]}],"files":[],"unfurls":[],
     "provenance":{"provider":"slack","openUrl":"https://app.slack.com/client/T1/C1/p\(id.replacingOccurrences(of: ".", with: ""))","degraded":false,"subtype":null}}
    """
}

/// A fake connector: routes by path, records requests, and can answer 429.
private final class FakeConnector: @unchecked Sendable {
    var requests: [(method: String, path: String, body: [String: Any]?)] = []
    var rateLimitHistory = false
    var streamPages: [String] = []

    func transport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path + (request.url!.query.map { "?\($0)" } ?? "")
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        requests.append((request.httpMethod ?? "GET", path, body))
        func reply(_ json: String, status: Int = 200, headers: [String: String] = [:]) -> (Data, HTTPURLResponse) {
            (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!)
        }
        switch (request.httpMethod, request.url!.path) {
        case ("GET", "/v1/connection"):
            return reply(#"{"identity":{"environment":"slack","enterpriseId":null,"teamId":"T1","userId":"U1"},"teamName":"Acme","userName":"alice","capabilities":{"identity":true,"sendAsUser":true,"readConversations":true,"readHistory":true,"liveUpdates":true,"reactions":false,"readState":false,"search":false,"files":false},"grantStatus":"active","scopes":[]}"#)
        case ("GET", "/v1/workspace"):
            return reply(#"{"id":"T1","slug":"T1","name":"Acme","createdBy":"","createdAt":"","sidebarColor":"slate","avatarUrl":null,"googleSelfRegisterDomain":null,"role":"member"}"#)
        case ("GET", "/v1/conversations"):
            return reply(#"{"conversations":[{"id":"C1","workspaceId":"T1","name":"testing","kind":"standard","topic":"t","isPrivate":false,"createdBy":"U1","createdAt":"","archivedAt":null,"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,"unreadThreadRootIds":[],"notifyLevel":1,"parentId":null,"provenance":{"provider":"slack","openUrl":"https://app.slack.com/client/T1/C1"}},{"id":"D1","workspaceId":"T1","name":null,"kind":"dm","topic":null,"isPrivate":true,"createdBy":"","createdAt":"","archivedAt":null,"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,"unreadThreadRootIds":[],"notifyLevel":1,"parentId":null,"memberIds":["U2","U1"]}]}"#)
        case ("GET", "/v1/members"):
            return reply(#"{"members":[{"userId":"U1","displayName":"alice","email":"a@example.test","avatarUrl":"https://avatars.example.test/a.png","statusEmoji":"🎉","statusText":"yay","title":"QA","isAgent":false,"isBot":false,"sponsorId":null,"privacyMode":false,"role":"admin","joinedAt":""},{"userId":"U2","displayName":"Bob","email":"","avatarUrl":null,"statusEmoji":"","statusText":"","title":"","isAgent":false,"isBot":false,"sponsorId":null,"privacyMode":false,"role":"member","joinedAt":""}]}"#)
        case ("GET", "/v1/history"):
            if rateLimitHistory { return reply(#"{"error":"rate_limited"}"#, status: 429, headers: ["Retry-After": "60"]) }
            return reply(#"{"messages":[\#(messageJSON(ts1)),\#(messageJSON(ts2, threadRootId: ts1))],"cursor":"older","partial":true}"#)
        case ("GET", "/v1/replies"):
            return reply(#"{"root":\#(messageJSON(ts1)),"replies":[\#(messageJSON(ts2))],"cursor":null,"partial":false}"#)
        case ("POST", "/v1/messages"):
            return reply(#"{"channel":"C1","ts":"1700000000.000001","userId":"U1","message":\#(messageJSON("1700000000.000001"))}"#)
        case ("PATCH", "/v1/messages"):
            return reply(messageJSON(ts1, editedAt: "2026-09-11T23:00:00.000Z"))
        case ("DELETE", "/v1/messages"):
            return reply(#"{"ok":true}"#)
        case ("POST", "/v1/reactions"):
            return reply(#"{"error":"missing_scopes"}"#, status: 403)
        case ("GET", "/v1/stream"):
            let page = streamPages.isEmpty ? #"{"events":[],"seq":0,"gap":false}"# : streamPages.removeFirst()
            return reply(page)
        case ("DELETE", "/v1/session"):
            return reply(#"{"ok":true}"#)
        default:
            return reply(#"{"error":"not_found"}"#, status: 404)
        }
    }
}

private final class Collected: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []
    var items: [String] { lock.lock(); defer { lock.unlock() }; return storage }
    var count: Int { items.count }
    func add(_ item: String) { lock.lock(); storage.append(item); lock.unlock() }
}

private func makeBackend(_ fake: FakeConnector, granted: [String: Bool] = ["sendAsUser": true, "readConversations": true, "readHistory": true, "liveUpdates": true], autoPoll: Bool = true) -> SlackBackend {
    SlackBackend(connectionId: "conn-1", origin: URL(string: "https://connector.test")!, teamId: "T1", userId: "U1", label: "Acme · alice",
                 granted: granted, credential: { "credential-1" }, transport: fake.transport, autoPoll: autoPoll)
}

@Suite struct SlackCapabilityTests {
    @Test func gatesFlowOnlyControlsAndNamesTheMissingScope() {
        let caps = SlackBackend.capabilities(granted: ["sendAsUser": true, "readHistory": true, "readConversations": true, "liveUpdates": true])
        #expect(caps[.send] == .supported)
        #expect(caps[.history].state == .limited)
        #expect(caps[.history].reason?.contains("one history page per minute") == true)
        #expect(caps[.reactions].state == .unavailable)
        #expect(caps[.reactions].reason == "This Slack app has not been granted reaction permissions.")
        #expect(caps[.artifacts].state == .unavailable)
        #expect(caps[.huddles].usable == false)
        #expect(caps[.readState].reason?.contains("stays on this device") == true)
        #expect(Capabilities.allSupported[.artifacts] == .supported)
    }

    @Test func mapsEmojiBothWays() {
        #expect(SlackBackend.shortcode(for: "✅") == "white_check_mark")
        #expect(SlackBackend.shortcode(for: ":custom_thing:") == "custom_thing")
        #expect(SlackBackend.shortcode(for: "not an emoji") == nil)
        #expect(EmojiShortcodes.emoji(for: "white_check_mark") == "✅")
    }
}

@Suite struct SlackBackendTests {
    @Test func bootsThroughTheConnectorAndSynthesizesTheUser() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let me = try await backend.currentUser()
        #expect(me.id == "U1")
        #expect(me.displayName == "alice")
        #expect(me.avatarUrl == "https://avatars.example.test/a.png")
        #expect(await backend.auth().status == .authenticated)
        #expect(await backend.auth().label == "Acme · alice")
        let workspaces = try await backend.listWorkspaces()
        #expect(workspaces.map(\.id) == ["T1"])
        let channels = try await backend.listConversations(workspaceId: "T1")
        #expect(channels.map(\.id) == ["C1", "D1"])
        #expect(channels[1].isDM)
        #expect(channels[1].memberIds == ["U2", "U1"])
        #expect(fake.requests.allSatisfy { $0.path.hasPrefix("/v1/") }, "no Flow path is ever built for a Slack team")
    }

    @Test func historyKeepsTsVerbatimSplitsProvenanceAndReportsPartialPages() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let page = try await backend.history(channelId: "C1", cursor: nil, limit: 50)
        #expect(page.messages.map(\.id) == [ts1, ts2])
        #expect(page.messages[0].body == "hello **bold**")
        #expect(page.messages[0].reactions == [ReactionAgg(emoji: "✅", count: 1, userIds: ["U2"])])
        #expect(page.messages[1].threadRootId == ts1)
        #expect(page.provenance[ts1]?.openUrl == "https://app.slack.com/client/T1/C1/p1789171841148649")
        #expect(page.provenance[ts1]?.degraded == false)
        #expect(page.cursor == "older")
        #expect(page.partial)
        #expect(fake.requests.last?.path == "/v1/history?channel=C1&limit=15", "the request never asks Slack for more than its page cap")
        let thread = try await backend.thread(channelId: "C1", rootId: ts1, cursor: nil)
        #expect(thread.root.id == ts1)
        #expect(thread.replies.map(\.id) == [ts2])
    }

    @Test func rateLimitBecomesAWaitNotARetry() async throws {
        let fake = FakeConnector()
        fake.rateLimitHistory = true
        let backend = makeBackend(fake)
        var caught: BackendError?
        do { _ = try await backend.history(channelId: "C1", cursor: nil, limit: 15) } catch let error as BackendError { caught = error }
        #expect(caught?.code == .rateLimited)
        #expect(caught?.retryAfter == 60)
        #expect(fake.requests.filter { $0.path.hasPrefix("/v1/history") }.count == 1, "one request per call; no automatic retry")
    }

    @Test func mutationsGoThroughTheConnectorAndScopeGapsAreUnsupported() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let sent = try await backend.send(SendMessageInput(channelId: "C1", body: "hi", clientMsgId: "cm-1", threadRootId: ts1))
        #expect(sent.id == "1700000000.000001")
        #expect(sent.clientMsgId == "cm-1", "the local idempotency key is stamped so the pending row reconciles")
        #expect(fake.requests.last?.body?["thread_ts"] as? String == ts1)
        let edited = try await backend.edit(channelId: "C1", messageId: ts1, body: "changed")
        #expect(edited.editedAt != nil)
        try await backend.delete(channelId: "C1", messageId: ts1, purge: false)
        #expect(fake.requests.last?.method == "DELETE")
        do { try await backend.setReaction(channelId: "C1", messageId: ts1, emoji: "✅", on: true); #expect(Bool(false)) } catch let error as BackendError {
            #expect(error.code == .unsupported)
        }
        // Read state without the scope is local-only: no request is made.
        let before = fake.requests.count
        try await backend.markRead(channelId: "C1", messageId: ts1, threadRootId: nil)
        #expect(fake.requests.count == before)
        do { _ = try await backend.uploadFile(workspaceId: "T1", channelId: "C1", data: Data(), name: "a.txt", mimeType: "text/plain"); #expect(Bool(false)) } catch let error as BackendError {
            #expect(error.code == .unsupported)
        }
        do { _ = try await backend.send(SendMessageInput(channelId: "C1", body: "x", clientMsgId: "cm-2", fileIds: ["F1"])); #expect(Bool(false)) } catch let error as BackendError {
            #expect(error.code == .unsupported, "a send with files never falls through to another path")
        }
    }

    @Test func streamDeliversRoutedEventsAndReportsGaps() async throws {
        let fake = FakeConnector()
        fake.streamPages = [
            #"{"events":[{"type":"message.created","message":\#(messageJSON(ts2))},{"type":"reaction.added","channelId":"C1","messageId":"\#(ts1)","emoji":"👀","userId":"U2"},{"type":"message.deleted","channelId":"C1","messageId":"\#(ts1)","threadRootId":null}],"seq":3,"gap":false}"#,
            #"{"events":[],"seq":3,"gap":true}"#,
        ]
        let backend = makeBackend(fake, autoPoll: false) // the test drives each poll
        let received = Collected()
        let stream = backend.events()
        let collector = Task {
            for await event in stream {
                switch event {
                case .messageCreated(let m): received.add("created:\(m.id)")
                case .reactionChanged(_, let id, let emoji, _, let added): received.add("reaction:\(id):\(emoji):\(added)")
                case .messageDeleted(_, let id, _): received.add("deleted:\(id)")
                case .streamDegraded: received.add("degraded")
                case .streamRecovered: received.add("recovered")
                default: received.add("other")
                }
                if received.count >= 5 { break }
            }
        }
        await backend.pollOnce()
        await backend.pollOnce()
        _ = await collector.value
        #expect(received.items == ["created:\(ts2)", "reaction:\(ts1):👀:true", "deleted:\(ts1)", "degraded", "recovered"])
        #expect(fake.requests.filter { $0.path.hasPrefix("/v1/stream") }.map(\.path) == ["/v1/stream?since=0", "/v1/stream?since=3"], "the cursor advances")
    }

    @Test func openInSlackDeepLinksUseTheTeamAndTs() {
        let backend = makeBackend(FakeConnector())
        #expect(backend.openURL(channelId: "C1", messageId: nil)?.absoluteString == "https://app.slack.com/client/T1/C1")
        #expect(backend.openURL(channelId: "C1", messageId: ts1)?.absoluteString == "https://app.slack.com/client/T1/C1/p1789171841148649")
    }
}

@Suite struct SlackRegistryTests {
    @Test func slackTeamsAreDistinctConnectionsWithOneWorkspaceBindingEach() throws {
        var registry = ConnectionRegistry()
        registry.addFlowConnection(origin: try CanonicalOrigin.normalize("https://flow.example.com"))
        let a = try registry.addSlackConnection(connectorOrigin: "https://connector.test", enterpriseId: nil, teamId: "T1", userId: "U1", teamName: "Acme", userName: "alice", capabilities: ["sendAsUser": true])
        let b = try registry.addSlackConnection(connectorOrigin: "https://connector.test", enterpriseId: nil, teamId: "T2", userId: "U1", teamName: "Acme", userName: "alice", capabilities: [:])
        #expect(registry.connections.count == 3)
        #expect(a.connectionId != b.connectionId)
        #expect(a.providerIdentity == "[\"slack\",null,\"T1\",\"U1\"]")
        #expect(a.providerIdentity != b.providerIdentity, "same name, different teams, never merged")
        #expect(registry.bindings.map { [$0.connectionId, $0.workspaceId] } == [[a.connectionId, "T1"], [b.connectionId, "T2"]])
        #expect(registry.session(a.connectionId)?.status == .authenticated)
        #expect(registry.session(a.connectionId)?.credentialRef != registry.session(b.connectionId)?.credentialRef)
        #expect(registry.activeConnectionId == registry.connections[0].connectionId, "adding Slack does not steal the active connection")
    }

    @Test func renamedWorkspaceKeepsItsIdentityAndConnectorChangeIsRefused() throws {
        var registry = ConnectionRegistry()
        let first = try registry.addSlackConnection(connectorOrigin: "https://connector.test", enterpriseId: nil, teamId: "T1", userId: "U1", teamName: "Acme", userName: "alice", capabilities: [:])
        let renamed = try registry.addSlackConnection(connectorOrigin: "https://connector.test", enterpriseId: nil, teamId: "T1", userId: "U1", teamName: "Acme Corp", userName: "alice", capabilities: ["sendAsUser": true])
        #expect(renamed.connectionId == first.connectionId)
        #expect(renamed.label == "Acme Corp · alice")
        #expect(registry.connections.count == 1)
        #expect(registry.bindings.count == 1)
        #expect(registry.bindings[0].name == "Acme Corp")
        #expect(throws: SlackConnectionError.connectorChanged) {
            try registry.addSlackConnection(connectorOrigin: "https://other.test", enterpriseId: nil, teamId: "T1", userId: "U1", teamName: "Acme", userName: "alice", capabilities: [:])
        }
        let other = try registry.addSlackConnection(connectorOrigin: "https://connector.test", enterpriseId: nil, teamId: "T1", userId: "U9", teamName: "Acme", userName: "bob", capabilities: [:])
        #expect(other.connectionId != first.connectionId, "a different user on the same team is a different connection")
    }

    @Test func slackTsHelpersNeverGoThroughAFloat() {
        #expect(SlackIdentity.isTs("1789171841.148649"))
        #expect(!SlackIdentity.isTs("1789171841.14864"))
        #expect(!SlackIdentity.isTs("1789171841"))
        #expect(SlackIdentity.messageKey(connectionId: "c", teamId: "T1", channelId: "C1", ts: "1789171841.100000") == "slack:c:T1:C1:1789171841.100000")
        #expect(SlackIdentity.messageKey(connectionId: "c", teamId: "T1", channelId: "C1", ts: "bad") == nil)
        #expect(SlackIdentity.date(fromTs: "1789171841.148649")?.timeIntervalSince1970 == 1789171841.148)
    }
}
