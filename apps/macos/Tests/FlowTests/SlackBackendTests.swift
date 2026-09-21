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
    var uploads: [(contentType: String?, authorization: String?, data: Data)] = []
    var rateLimitHistory = false
    var streamPages: [String] = []
    var imageRequests: [(host: String, authorization: String?)] = []

    func transport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if let host = request.url?.host, host != "connector.test" {
            imageRequests.append((host, request.value(forHTTPHeaderField: "Authorization")))
            return (Data([0x89, 0x50, 0x4E, 0x47]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
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
        case ("PATCH", "/v1/me"):
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer credential-1")
            return reply(#"{"id":"U1","email":"a@example.test","displayName":"alice","avatarUrl":null,"timezone":"UTC","statusEmoji":"🤒","statusText":"Out sick","website":"","bio":"","title":"","isAgent":false,"sponsorId":null,"notificationPrefs":{},"statusSuppressAlerts":false,"privacyMode":false,"createdAt":""}"#)
        case ("DELETE", "/v1/session"):
            return reply(#"{"ok":true}"#)
        case ("POST", "/v1/files"):
            uploads.append((request.value(forHTTPHeaderField: "Content-Type"), request.value(forHTTPHeaderField: "Authorization"), request.httpBody ?? Data()))
            return reply(#"{"id":"F0UPLOAD1","workspaceId":"T1","userId":"U1","name":"notes one.txt","mimeType":"text/plain","sizeBytes":5,"width":null,"height":null,"hasThumb":false,"createdAt":""}"#)
        case ("GET", "/v1/files/team-icon:T1"):
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer credential-1")
            return (Data([0x47, 0x49, 0x46]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!)
        case ("GET", "/v1/files/F1/thumb"):
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer credential-1")
            return (Data([0x89, 0x50, 0x4E, 0x47]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!)
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

    @Test func loadOlderButtonSaysTheHistoryBudget() {
        let slack = SlackBackend.capabilities(granted: ["readHistory": true])
        #expect(slack.loadOlderLabel(wait: 0) == "Load earlier messages (15 max/min)")
        #expect(slack.loadOlderLabel(wait: 42) == "Load earlier messages (wait 42s)")
        #expect(Capabilities.allSupported.loadOlderLabel(wait: 0) == "Load earlier messages")
    }

    @Test func mapsEmojiBothWays() {
        #expect(SlackBackend.shortcode(for: "✅") == "white_check_mark")
        #expect(SlackBackend.shortcode(for: ":custom_thing:") == "custom_thing")
        #expect(SlackBackend.shortcode(for: "not an emoji") == nil)
        #expect(EmojiShortcodes.emoji(for: "white_check_mark") == "✅")
    }
}

@Suite struct SlackSignInTests {
    /// AuthenticationServices calls back on a background queue. A main-actor
    /// closure there trips Swift's executor check and kills the app — that was
    /// the crash on Connect Slack in macOS 2.2.105.
    @Test func webAuthCallbackIsDeliveredOffTheMainActor() async throws {
        let expected = URL(string: "flow://slack/connected?operationId=abc")!
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global().async {
                #expect(!Thread.isMainThread)
                SlackBrowserSignIn.deliver(callback: expected, error: nil, to: continuation)
            }
        }
        #expect(callback == expected)
    }
}

@Suite struct SlackBackendTests {
    /// Slack file bytes come through the connector with its credential, and
    /// only file paths are accepted.
    @Test func fetchesFileBytesThroughTheConnectorOnly() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let data = try await backend.fileData(path: "/v1/files/F1/thumb")
        #expect(data == Data([0x89, 0x50, 0x4E, 0x47]))
        #expect(fake.requests.last?.path == "/v1/files/F1/thumb")
        await #expect(throws: BackendError.self) { try await backend.fileData(path: "/v1/history?channel=C1") }
        await #expect(throws: BackendError.self) { try await backend.fileData(path: "v1/files/../session") }
        #expect(fake.requests.count == 1)
    }

    /// Slack profile photos are public https URLs: loaded directly, never with
    /// the connector credential, and only from Slack's image hosts.
    @Test func loadsSlackProfilePhotosWithoutTheCredential() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let data = try await backend.fileData(path: "https://avatars.slack-edge.com/2025-01-01/123_abc_72.jpg")
        #expect(data == Data([0x89, 0x50, 0x4E, 0x47]))
        #expect(fake.imageRequests.map(\.host) == ["avatars.slack-edge.com"])
        #expect(fake.imageRequests.first?.authorization == nil)
        await #expect(throws: BackendError.self) { try await backend.fileData(path: "https://evil.example/a.png") }
        await #expect(throws: BackendError.self) { try await backend.fileData(path: "http://avatars.slack-edge.com/a.png") }
        await #expect(throws: BackendError.self) { try await backend.fileData(path: "https://slack-edge.com.evil.example/a.png") }
        #expect(fake.imageRequests.count == 1)
        #expect(fake.requests.isEmpty, "the connector is not asked for a public photo")
    }

    /// With files:write the bytes go to the connector raw, with their type and
    /// the channel; the send then shares them, text optional.
    @Test func uploadsRawBytesToTheConnectorAndSendsFileIds() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake, granted: ["sendAsUser": true, "readConversations": true, "readHistory": true, "liveUpdates": true, "files": true])
        let file = try await backend.uploadFile(workspaceId: "T1", channelId: "C1", data: Data("hello".utf8), name: "notes one.txt", mimeType: "text/plain")
        #expect(file.id == "F0UPLOAD1")
        #expect(fake.requests.last?.path == "/v1/files?channel=C1&name=notes%20one%2Etxt")
        #expect(fake.uploads.first?.contentType == "text/plain")
        #expect(fake.uploads.first?.authorization == "Bearer credential-1")
        #expect(fake.uploads.first?.data == Data("hello".utf8))
        _ = try await backend.send(SendMessageInput(channelId: "C1", body: "", clientMsgId: "cm-9", fileIds: ["F0UPLOAD1"]))
        #expect(fake.requests.last?.path == "/v1/messages")
        #expect(fake.requests.last?.body?["file_ids"] as? [String] == ["F0UPLOAD1"])
        #expect(fake.requests.last?.body?["text"] as? String == "")
        #expect(SlackBackend.capabilities(granted: ["files": true])[.files] == .supported)
        #expect(SlackBackend.capabilities(granted: [:])[.files].reason == "File uploads need a Slack permission this app does not have. Reconnect Slack after it is added.")
    }

    @Test func teamIconPathKeepsItsColonAndRendersAsTheWorkspaceMark() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let data = try await backend.fileData(path: "/v1/files/team-icon:T1")
        #expect(data == Data([0x47, 0x49, 0x46]))
        #expect(fake.requests.last?.path == "/v1/files/team-icon:T1")
        let slack = Workspace(id: "T1", slug: "T1", name: "Acme", createdBy: "", createdAt: "", avatarUrl: "/v1/files/team-icon:T1")
        #expect(slack.avatarImagePath == "/v1/files/team-icon:T1")
        let flow = Workspace(id: "w1", slug: "w", name: "W", createdBy: "", createdAt: "", avatarUrl: "/v1/avatars/abc")
        #expect(flow.avatarImagePath == "/v1/avatars/abc")
        let foreign = Workspace(id: "w2", slug: "x", name: "X", createdBy: "", createdAt: "", avatarUrl: "https://evil.test/a.png")
        #expect(foreign.avatarImagePath == nil)
    }

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

    @Test func memberUpdatedEventsCarryTheNewStatus() async throws {
        let fake = FakeConnector()
        fake.streamPages = [
            #"{"events":[{"type":"member.updated","member":{"userId":"U1","displayName":"alice","email":"a@example.test","avatarUrl":null,"statusEmoji":"🤒","statusText":"Out sick","title":"","isAgent":false,"isBot":false,"sponsorId":null,"privacyMode":false,"role":"admin","joinedAt":""}}],"seq":1,"gap":false}"#,
        ]
        let backend = makeBackend(fake, autoPoll: false)
        let stream = backend.events()
        let collector = Task { () -> User? in
            for await event in stream { if case .memberUpdated(let user) = event { return user } }
            return nil
        }
        await backend.pollOnce()
        let user = await collector.value
        #expect(user?.id == "U1")
        #expect(user?.statusEmoji == "🤒")
        #expect(user?.statusText == "Out sick")
    }

    @Test func channelActivityEventsCarryTheNewTime() async throws {
        let fake = FakeConnector()
        fake.streamPages = [
            #"{"events":[{"type":"channel.activity","channelId":"C1","lastActivityAt":"2026-09-15T17:00:00.000Z"},{"type":"channel.activity","channelId":"C2"}],"seq":2,"gap":false}"#,
        ]
        let backend = makeBackend(fake, autoPoll: false)
        let stream = backend.events()
        let collector = Task { () -> (String, String)? in
            for await event in stream { if case .channelActivity(let id, let at) = event { return (id, at) } }
            return nil
        }
        await backend.pollOnce()
        let got = await collector.value
        #expect(got?.0 == "C1")
        #expect(got?.1 == "2026-09-15T17:00:00.000Z")
    }

    @Test func setStatusPatchesTheConnectorAndIsGatedByTheScope() async throws {
        let fake = FakeConnector()
        let backend = makeBackend(fake)
        let me = try await backend.setStatus(emoji: "🤒", text: "Out sick", suppressAlerts: false)
        #expect(me.statusText == "Out sick")
        let sent = try #require(fake.requests.last)
        #expect(sent.method == "PATCH" && sent.path == "/v1/me")
        #expect(sent.body?["statusEmoji"] as? String == "🤒")
        #expect(sent.body?["statusText"] as? String == "Out sick")
        #expect(SlackBackend.capabilities(granted: ["setStatus": true])[.status].state == .supported)
        #expect(SlackBackend.capabilities(granted: [:])[.status].state == .unavailable)
        #expect(Capabilities.allSupported[.status].state == .supported, "a Flow server sets status as before")
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


/// Slack inactive conversations: hidden unless known active in 30 days,
/// unread, or open; a Flow workspace is never split.
@Suite struct InactiveConversationTests {
    private let now = Channel.parseActivityDate("2026-09-15T12:00:00.000Z")!

    private func channel(_ id: String, activity: String? = nil, unread: Int = 0, notifications: Int = 0) -> Channel {
        Channel(id: id, workspaceId: "T1", name: id, topic: nil, isPrivate: false, createdBy: "", createdAt: "",
                archivedAt: nil, isMember: true, lastReadMsgId: nil, unreadCount: unread,
                unreadNotifications: notifications, lastActivityAt: activity)
    }

    @Test func rule() {
        #expect(!channel("unknown").isRecentlyActive(selectedId: nil, now: now))
        #expect(channel("recent", activity: "2026-08-17T12:00:00.000Z").isRecentlyActive(selectedId: nil, now: now), "29 days")
        #expect(!channel("old", activity: "2026-08-15T11:00:00Z").isRecentlyActive(selectedId: nil, now: now), "31 days")
        #expect(channel("unread", unread: 2).isRecentlyActive(selectedId: nil, now: now))
        #expect(channel("mention", notifications: 1).isRecentlyActive(selectedId: nil, now: now))
        #expect(channel("open").isRecentlyActive(selectedId: "open", now: now))
    }

    @Test func splitOnlyForAProvider() {
        let list = [channel("a", activity: "2026-09-14T00:00:00.000Z"), channel("b"), channel("c", activity: "2025-01-01T00:00:00.000Z")]
        let slack = Channel.splitInactive(list, isProvider: true, selectedId: nil, now: now)
        #expect(slack.active.map(\.id) == ["a"])
        #expect(slack.inactiveCount == 2)
        let flow = Channel.splitInactive(list, isProvider: false, selectedId: nil, now: now)
        #expect(flow.active.count == 3 && flow.inactiveCount == 0)
    }

    @Test func decodesLastActivityAt() throws {
        let json = #"{"id":"C1","workspaceId":"T1","name":"eng","kind":"standard","createdBy":"","createdAt":"","lastActivityAt":"2026-09-15T17:00:00.000Z"}"#
        let decoded = try JSONDecoder().decode(Channel.self, from: Data(json.utf8))
        #expect(decoded.lastActivityAt == "2026-09-15T17:00:00.000Z")
        let flow = try JSONDecoder().decode(Channel.self, from: Data(#"{"id":"c1","workspaceId":"w1","name":"eng","createdBy":"","createdAt":""}"#.utf8))
        #expect(flow.lastActivityAt == nil)
    }
}
