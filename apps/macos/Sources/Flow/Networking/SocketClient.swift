import Foundation

enum SocketSignal: Sendable {
    case connected(sessionId: String)
    case disconnected
    case event(EventDTO)
}

/// WebSocket client. Connects, authenticates, replies to server pings,
/// reconnects with exponential backoff, and yields signals to the SyncEngine.
actor SocketClient {
    private let url: URL
    private let session: URLSession
    private var token: String?
    private var runTask: Task<Void, Never>?
    private var wsTask: URLSessionWebSocketTask?
    private var continuation: AsyncStream<SocketSignal>.Continuation?

    init(url: URL) {
        self.url = url
        self.session = URLSession(configuration: .default)
    }

    /// Starts (or restarts) the connect loop. The returned stream delivers
    /// connection state changes and decoded events until `stop()`.
    func start(token: String) -> AsyncStream<SocketSignal> {
        teardown()
        self.token = token
        let (stream, cont) = AsyncStream.makeStream(of: SocketSignal.self)
        continuation = cont
        runTask = Task { await run() }
        return stream
    }

    func stop() {
        teardown()
    }

    /// Sends a typing frame if connected. (Throttling lives in SyncEngine.)
    /// `threadRootId` scopes the indicator to a thread's composer.
    func sendTyping(channelId: String, threadRootId: String? = nil) async {
        guard let wsTask else { return }
        var frame: [String: String] = ["op": "typing", "channelId": channelId]
        if let threadRootId { frame["threadRootId"] = threadRootId }
        guard let data = try? JSONEncoder().encode(frame),
              let text = String(data: data, encoding: .utf8) else { return }
        try? await wsTask.send(.string(text))
    }

    // MARK: Internals

    private func teardown() {
        token = nil
        runTask?.cancel()
        runTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        continuation?.finish()
        continuation = nil
    }

    private func run() async {
        var attempt = 0
        let decoder = JSONDecoder()
        while !Task.isCancelled {
            guard let token else { break }
            let ws = session.webSocketTask(with: url)
            wsTask = ws
            ws.resume()
            do {
                let auth: [String: String] = ["op": "auth", "token": token]
                let authData = try JSONEncoder().encode(auth)
                try await ws.send(.string(String(data: authData, encoding: .utf8) ?? ""))

                while !Task.isCancelled {
                    let message = try await ws.receive()
                    let data: Data?
                    switch message {
                    case .string(let s): data = s.data(using: .utf8)
                    case .data(let d): data = d
                    @unknown default: data = nil
                    }
                    guard let data,
                          let frame = try? decoder.decode(ServerFrame.self, from: data) else {
                        continue
                    }
                    switch frame {
                    case .hello(let sessionId):
                        attempt = 0
                        continuation?.yield(.connected(sessionId: sessionId))
                    case .ping:
                        try await ws.send(.string(#"{"op":"pong"}"#))
                    case .event(let event):
                        continuation?.yield(.event(event))
                    case .unknown:
                        break
                    }
                }
            } catch {
                // Fall through to reconnect.
            }
            wsTask?.cancel(with: .goingAway, reason: nil)
            wsTask = nil
            if Task.isCancelled || self.token == nil { break }
            continuation?.yield(.disconnected)
            attempt += 1
            // Exponential backoff with jitter, capped at 30s.
            let base = min(30.0, 0.5 * pow(2.0, Double(min(attempt, 7))))
            let delay = base * (0.75 + Double.random(in: 0...0.5))
            try? await Task.sleep(for: .seconds(delay))
        }
    }
}
