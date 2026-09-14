import Foundation
import Testing
@testable import Flow

/// Transport behaviour of a session runtime (#540): a stale 401 cannot kill the
/// session that replaced it, and the bearer never leaves the backend's exact
/// origin. Both are answers to real requests, so they are checked against a
/// stubbed `URLProtocol` rather than asserted about the code shape.

/// Scripted responses, keyed by the URL the request went to.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    struct Recorded: Sendable {
        let url: URL
        let authorization: String?
    }

    /// `(status, headers)` per absolute URL; anything unlisted answers 200.
    nonisolated(unsafe) static var responses: [String: (Int, [String: String])] = [:]
    /// Requests seen, in order — including the ones a redirect produced.
    nonisolated(unsafe) static var recorded: [Recorded] = []
    /// Requests that should not answer until `release()` is called.
    nonisolated(unsafe) static var holdURLs: Set<String> = []
    nonisolated(unsafe) private static var held: [() -> Void] = []
    private static let lock = NSLock()

    static func reset() {
        lock.lock()
        responses = [:]
        recorded = []
        holdURLs = []
        held = []
        lock.unlock()
    }

    static func release() {
        lock.lock()
        let pending = held
        held = []
        lock.unlock()
        pending.forEach { $0() }
    }

    static func requests() -> [Recorded] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = self.request
        guard let url = request.url else { return }
        StubProtocol.lock.lock()
        StubProtocol.recorded.append(Recorded(
            url: url,
            authorization: request.value(forHTTPHeaderField: "Authorization")
        ))
        let scripted = StubProtocol.responses[url.absoluteString] ?? (200, [:])
        let shouldHold = StubProtocol.holdURLs.contains(url.absoluteString)
        StubProtocol.lock.unlock()

        let deliver = { [weak self] in
            guard let self else { return }
            let (status, headers) = scripted
            if let location = headers["Location"], let next = URL(string: location, relativeTo: url) {
                // A real redirect, so the session's own delegate decides what
                // the follow-up request may carry.
                let response = HTTPURLResponse(
                    url: url, statusCode: status, httpVersion: "HTTP/1.1",
                    headerFields: ["Location": next.absoluteString]
                )!
                self.client?.urlProtocol(
                    self, wasRedirectedTo: URLRequest(url: next), redirectResponse: response
                )
                return
            }
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers
            )!
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: Data("{}".utf8))
            self.client?.urlProtocolDidFinishLoading(self)
        }

        if shouldHold {
            StubProtocol.lock.lock()
            StubProtocol.held.append(deliver)
            StubProtocol.lock.unlock()
        } else {
            deliver()
        }
    }

    override func stopLoading() {}
}

/// Counts sign-out reports so a stale 401 can be shown not to produce one.
private actor UnauthorizedCounter {
    private(set) var count = 0
    func record() { count += 1 }
}

private struct Empty: Decodable, Sendable {}

/// One suite, serialized: `StubProtocol`'s scripted responses are process-wide,
/// so two of these running at once would answer each other's requests.
@Suite(.serialized) struct APIClientSessionTests {
    private let origin = URL(string: "https://a.example.com")!

    private func client() -> APIClient {
        APIClient(baseURL: origin, protocolClasses: [StubProtocol.self])
    }

    @Test func aStale401DoesNotSignOutTheSessionThatReplacedIt() async throws {
        StubProtocol.reset()
        defer { StubProtocol.reset() }
        StubProtocol.responses["https://a.example.com/v1/me"] = (401, [:])
        StubProtocol.holdURLs = ["https://a.example.com/v1/me"]

        let api = client()
        let counter = UnauthorizedCounter()
        await api.setUnauthorizedHandler { await counter.record() }
        await api.setToken("old")

        // The request goes out under "old" and is still in flight…
        let stale = Task { try? await api.get("/v1/me") as Empty }
        try await Task.sleep(for: .milliseconds(120))
        // …when the token is replaced. Its 401 says nothing about the new one.
        await api.setToken("fresh")
        StubProtocol.release()
        _ = await stale.value

        #expect(await counter.count == 0)
    }

    @Test func a401OnTheCurrentGenerationIsBelieved() async throws {
        StubProtocol.reset()
        defer { StubProtocol.reset() }
        StubProtocol.responses["https://a.example.com/v1/me"] = (401, [:])

        let api = client()
        let counter = UnauthorizedCounter()
        await api.setUnauthorizedHandler { await counter.record() }
        await api.setToken("fresh")
        _ = try? await api.get("/v1/me") as Empty

        #expect(await counter.count == 1)
    }

    @Test func replacingTheTokenBumpsTheGeneration() async {
        let api = client()
        #expect(await api.authGeneration == 0)
        await api.setToken("one")
        #expect(await api.authGeneration == 1)
        await api.setToken(nil)
        #expect(await api.authGeneration == 2)
    }

    @Test func sendsTheBearerToItsOwnOrigin() async throws {
        StubProtocol.reset()
        defer { StubProtocol.reset() }
        let api = client()
        await api.setToken("token-a")
        _ = try? await api.get("/v1/me") as Empty
        #expect(StubProtocol.requests().first?.authorization == "Bearer token-a")
    }

    @Test func dropsTheBearerWhenARedirectLeavesTheOrigin() async throws {
        StubProtocol.reset()
        defer { StubProtocol.reset() }
        StubProtocol.responses["https://a.example.com/v1/files/f"] =
            (302, ["Location": "https://bucket.r2.example/o?X-Amz-Signature=x"])

        let api = client()
        await api.setToken("token-a")
        _ = try? await api.getData("/v1/files/f")

        let seen = StubProtocol.requests()
        #expect(seen.count == 2)
        #expect(seen.first?.authorization == "Bearer token-a")
        #expect(seen.last?.url.host == "bucket.r2.example")
        #expect(seen.last?.authorization == nil)
    }

    @Test func dropsTheBearerWhenARedirectKeepsTheHostButChangesSchemeOrPort() async throws {
        for target in ["http://a.example.com/v1/files/f", "https://a.example.com:8443/v1/files/f"] {
            StubProtocol.reset()
            StubProtocol.responses["https://a.example.com/v1/files/f"] = (302, ["Location": target])
            let api = client()
            await api.setToken("token-a")
            _ = try? await api.getData("/v1/files/f")
            let seen = StubProtocol.requests()
            #expect(seen.count == 2, "expected a redirect for \(target)")
            #expect(seen.last?.authorization == nil, "bearer followed \(target)")
        }
        StubProtocol.reset()
    }

    @Test func authenticatesTheLocalUploadFallbackButNotAPresignedTarget() async throws {
        StubProtocol.reset()
        defer { StubProtocol.reset() }
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("flow-upload-\(UUID().uuidString).bin")
        try Data("bytes".utf8).write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let api = client()
        await api.setToken("token-a")
        try await api.putRaw("/v1/uploads/f", headers: [:], fromFile: tmp)
        try await api.putRaw(
            "https://bucket.r2.example/o?X-Amz-Signature=x", headers: [:], fromFile: tmp
        )

        let seen = StubProtocol.requests()
        #expect(seen.first?.url.absoluteString == "https://a.example.com/v1/uploads/f")
        #expect(seen.first?.authorization == "Bearer token-a")
        #expect(seen.last?.url.host == "bucket.r2.example")
        #expect(seen.last?.authorization == nil)
    }

    @Test func knowsWhichURLsItOwns() {
        let api = client()
        #expect(api.owns(URL(string: "https://a.example.com/v1/me")!))
        #expect(!api.owns(URL(string: "https://b.example.com/v1/me")!))
        #expect(!api.owns(URL(string: "https://a.example.com:8443/v1/me")!))
    }
}
