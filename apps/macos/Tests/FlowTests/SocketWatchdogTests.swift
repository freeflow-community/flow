import CryptoKit
import XCTest

@testable import Flow

// End-to-end proof for #271, against a real WebSocket connection: a server that
// completes the handshake, says hello, and then goes silent forever — which is
// what the client sees when the laptop lid closes. Before the watchdog, the
// client sat in `receive()` believing it was connected and `SyncEngine`'s
// reconnect backfill never ran. Deadlines are shortened (a second, not 70) so
// the same rule is testable in real time.
final class SocketWatchdogTests: XCTestCase {
    private var server: SilentWebSocketServer!

    override func tearDown() {
        server?.stop()
        server = nil
        super.tearDown()
    }

    private let fast = SocketLiveness(deadline: 1.5, wakeDeadline: 0.5, checkInterval: 0.2)

    func testASilentServerIsNoticedAndReconnected() async throws {
        server = try SilentWebSocketServer(greet: true)
        let client = SocketClient(url: server.url, liveness: fast)
        defer { Task { await client.stop() } }

        var sawConnected = false
        var sawDisconnected = false
        for await signal in await client.start(token: "t") {
            switch signal {
            case .connected: sawConnected = true
            case .disconnected: sawDisconnected = true
            case .event: break
            }
            // The whole point: silence has to end in a *re*connect, because
            // that is what triggers `backfillAfterReconnect()`.
            if sawConnected && sawDisconnected && server.connectionCount >= 2 { break }
        }

        XCTAssertTrue(sawConnected, "server said hello")
        XCTAssertTrue(sawDisconnected, "silence was noticed")
        XCTAssertGreaterThanOrEqual(server.connectionCount, 2, "and the client came back")
    }

    /// The wake nudge is a latency improvement on the same rule: after silence
    /// past the (shorter) wake deadline, `wake()` drops the socket immediately
    /// instead of waiting for the next watchdog tick.
    func testWakeDropsASocketThatWentQuietWhileWeWereNotLooking() async throws {
        // Watchdog effectively disabled, so only `wake()` can end this.
        let onlyWake = SocketLiveness(deadline: 3600, wakeDeadline: 0.5, checkInterval: 3600)
        server = try SilentWebSocketServer(greet: true)
        let client = SocketClient(url: server.url, liveness: onlyWake)
        defer { Task { await client.stop() } }

        let stream = await client.start(token: "t")
        var iterator = stream.makeAsyncIterator()
        guard case .connected = await iterator.next() else {
            return XCTFail("expected the server's hello")
        }

        try await Task.sleep(for: .milliseconds(700)) // "asleep" past the wake deadline
        await client.wake()

        guard case .disconnected = await iterator.next() else {
            return XCTFail("wake() should have dropped the silent socket")
        }
    }

    /// The failure this must not cause: a healthy connection that simply has
    /// nothing to say gets heartbeats, and heartbeats must keep it.
    func testAHeartbeatingServerIsLeftAlone() async throws {
        server = try SilentWebSocketServer(greet: true, heartbeatEvery: 0.3)
        let client = SocketClient(url: server.url, liveness: fast)
        defer { Task { await client.stop() } }

        let stream = await client.start(token: "t")
        var iterator = stream.makeAsyncIterator()
        guard case .connected = await iterator.next() else {
            return XCTFail("expected the server's hello")
        }

        // Several deadlines' worth of idle-but-pinged time.
        try await Task.sleep(for: .seconds(5))
        XCTAssertEqual(server.connectionCount, 1, "no reconnect: the socket was alive all along")
    }
}


/// A WebSocket server that greets and then says nothing — the half-open socket,
/// reproduced without a laptop. `heartbeatEvery` makes it a healthy idle server
/// instead, which is the control case.
///
/// POSIX sockets rather than `NWListener`: a Network.framework listener needs
/// entitlements a test bundle doesn't have, and the handshake is small enough
/// to write out. It speaks only what this test needs — the upgrade, then
/// unmasked text frames under 126 bytes.
private final class SilentWebSocketServer: @unchecked Sendable {
    private static let guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    private let listenFD: Int32
    private let lock = NSLock()
    private var clientFDs: [Int32] = []
    private var accepted = 0
    private var stopped = false

    let url: URL

    /// How many connections the client has made — one more than expected means
    /// it reconnected, which is the behaviour under test.
    var connectionCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return accepted
    }

    init(greet: Bool, heartbeatEvery: TimeInterval? = nil) throws {
        // Everything below works off the local `fd`: touching the property from
        // a closure would capture a half-initialized `self`.
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw XCTSkip("no socket") }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0 // any free port
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(fd, 4) == 0 else {
            close(fd)
            throw XCTSkip("could not listen on loopback")
        }

        var boundAddr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &boundAddr) {
            _ = $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        listenFD = fd
        url = URL(string: "ws://127.0.0.1:\(UInt16(bigEndian: boundAddr.sin_port))/v1/ws")!

        DispatchQueue.global().async { [self] in acceptLoop(greet: greet, heartbeatEvery: heartbeatEvery) }
    }

    func stop() {
        lock.lock()
        stopped = true
        let open = clientFDs
        clientFDs = []
        lock.unlock()
        close(listenFD)
        for fd in open { close(fd) }
    }

    // MARK: Internals

    private func acceptLoop(greet: Bool, heartbeatEvery: TimeInterval?) {
        while true {
            let fd = accept(listenFD, nil, nil)
            guard fd >= 0 else { return } // listener closed
            lock.lock()
            if stopped {
                lock.unlock()
                close(fd)
                return
            }
            accepted += 1
            clientFDs.append(fd)
            lock.unlock()

            guard handshake(fd) else {
                close(fd)
                continue
            }
            if greet { send(#"{"op":"hello","sessionId":"s1"}"#, to: fd) }
            if let heartbeatEvery { heartbeat(fd, every: heartbeatEvery) }
            // Drain whatever the client says (auth, pongs) so it never blocks
            // on a full buffer. Nothing is ever sent back.
            DispatchQueue.global().async { [self] in
                var scratch = [UInt8](repeating: 0, count: 1024)
                while read(fd, &scratch, scratch.count) > 0 {}
            }
        }
    }

    /// Reads the upgrade request and answers it. Anything unexpected drops the
    /// connection — the client under test only ever sends the one shape.
    private func handshake(_ fd: Int32) -> Bool {
        var request = ""
        var scratch = [UInt8](repeating: 0, count: 1024)
        while !request.contains("\r\n\r\n") {
            let n = read(fd, &scratch, scratch.count)
            guard n > 0 else { return false }
            request += String(decoding: scratch[0..<n], as: UTF8.self)
        }
        guard let line = request.split(separator: "\r\n").first(where: {
            $0.lowercased().hasPrefix("sec-websocket-key:")
        }) else { return false }
        let key = line.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)
        let accept = Data(Insecure.SHA1.hash(data: Data((key + Self.guid).utf8))).base64EncodedString()
        let response = """
            HTTP/1.1 101 Switching Protocols\r
            Upgrade: websocket\r
            Connection: Upgrade\r
            Sec-WebSocket-Accept: \(accept)\r
            \r\n
            """
        return write(fd, response, response.utf8.count) > 0
    }

    /// One unmasked text frame (payloads here are always under 126 bytes, so
    /// the length fits in the second byte).
    private func send(_ text: String, to fd: Int32) {
        let payload = Array(text.utf8)
        precondition(payload.count < 126)
        let frame: [UInt8] = [0x81, UInt8(payload.count)] + payload
        lock.lock()
        let live = clientFDs.contains(fd)
        lock.unlock()
        guard live else { return }
        _ = frame.withUnsafeBufferPointer { write(fd, $0.baseAddress, frame.count) }
    }

    private func heartbeat(_ fd: Int32, every interval: TimeInterval) {
        DispatchQueue.global().asyncAfter(deadline: .now() + interval) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let live = !self.stopped && self.clientFDs.contains(fd)
            self.lock.unlock()
            guard live else { return }
            self.send(#"{"op":"ping"}"#, to: fd)
            self.heartbeat(fd, every: interval)
        }
    }
}
