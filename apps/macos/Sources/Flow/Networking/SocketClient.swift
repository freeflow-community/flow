import Foundation

enum SocketSignal: Sendable {
    case connected(sessionId: String)
    case disconnected
    case event(EventDTO)
}

/// How long silence from the server means the socket is dead (#271).
///
/// The server heartbeats every 30s and terminates a socket that misses one, but
/// it can only say so over a working connection. When the machine sleeps or
/// Wi-Fi drops, TCP dies half-open: no FIN reaches us, `receive()` keeps
/// awaiting, and the client goes on believing it is connected. Nothing arriving
/// is the only symptom we get, so it has to be the signal.
struct SocketLiveness: Sendable {
    /// Two missed 30s heartbeats, plus slack. One missed beat is jitter.
    var deadline: TimeInterval = 70
    /// On wake we already know time passed unobserved, so one missed beat is
    /// enough to be suspicious — a needless reconnect costs a REST refresh.
    var wakeDeadline: TimeInterval = 30
    /// How often the watchdog looks. Fine enough that the deadline is the
    /// deadline, coarse enough to stay asleep almost always.
    var checkInterval: TimeInterval = 10

    /// What the app ships with. Tests shorten the same rule.
    static let standard = SocketLiveness()

    /// Silent for longer than `deadline` — presumed dead.
    func isDead(lastInboundAt: Date, now: Date, deadline: TimeInterval) -> Bool {
        now.timeIntervalSince(lastInboundAt) >= deadline
    }
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
    /// When the current socket last heard anything from the server.
    private var lastInboundAt: Date?
    private var watchdog: Task<Void, Never>?

    private let liveness: SocketLiveness

    init(url: URL, liveness: SocketLiveness = .standard) {
        self.url = url
        self.liveness = liveness
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

    /// The machine woke, or the app came back to the foreground. Time passed
    /// that we could not observe, so check the socket now rather than waiting
    /// out the watchdog — otherwise the first thing the user sees after opening
    /// the lid is up to 70s of stale sidebar.
    func wake() {
        dropIfSilent(deadline: liveness.wakeDeadline)
    }

    // MARK: Internals

    /// Cancels the socket if the server has gone quiet. The pending `receive()`
    /// then throws, so the run loop takes its ordinary error path: yield
    /// `.disconnected`, back off, reconnect — and the reconnect makes
    /// `SyncEngine.backfillAfterReconnect()` run, which is the point.
    private func dropIfSilent(deadline: TimeInterval) {
        guard let ws = wsTask, let lastInboundAt else { return }
        guard liveness.isDead(lastInboundAt: lastInboundAt, now: Date(), deadline: deadline) else { return }
        ws.cancel(with: .abnormalClosure, reason: nil)
    }

    private func startWatchdog() {
        watchdog?.cancel()
        let liveness = liveness
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(liveness.checkInterval))
                if Task.isCancelled { return }
                await self?.dropIfSilent(deadline: liveness.deadline)
            }
        }
    }

    private func stopWatchdog() {
        watchdog?.cancel()
        watchdog = nil
        lastInboundAt = nil
    }

    private func teardown() {
        token = nil
        runTask?.cancel()
        runTask = nil
        stopWatchdog()
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
            // Arm the watchdog from the attempt, not from `hello`: a socket
            // that opens and then says nothing is just as dead.
            lastInboundAt = Date()
            startWatchdog()
            do {
                let auth: [String: String] = ["op": "auth", "token": token]
                let authData = try JSONEncoder().encode(auth)
                try await ws.send(.string(String(data: authData, encoding: .utf8) ?? ""))

                while !Task.isCancelled {
                    let message = try await ws.receive()
                    // Any frame is proof of life — pings included, and they are
                    // what keeps an idle connection out of the watchdog's jaws.
                    lastInboundAt = Date()
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
            stopWatchdog()
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
