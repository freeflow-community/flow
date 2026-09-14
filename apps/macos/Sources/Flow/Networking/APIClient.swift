import Foundation

private struct ErrorEnvelope: Decodable {
    struct Inner: Decodable {
        let code: String
        let message: String
    }
    let error: Inner
}

struct APIError: Error, LocalizedError, Sendable {
    let status: Int
    let code: String
    let message: String

    var errorDescription: String? { message }

    /// The request was abandoned rather than failing — the caller's `.task`
    /// was cancelled, typically because the user moved on. Nothing to report
    /// to them (#447).
    var isCancellation: Bool { code == "cancelled" }

    /// Transport failure, cancellations kept distinguishable.
    static func network(_ error: Error) -> APIError {
        let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
        return APIError(
            status: 0,
            code: cancelled ? "cancelled" : "network",
            message: error.localizedDescription
        )
    }
}

/// Strips the Authorization header the moment a redirect leaves the backend's
/// exact origin — the server 302s file downloads to presigned R2 URLs, and
/// S3-style endpoints reject requests carrying both a signed query string and
/// an Authorization header. (CFNetwork's own header handling on redirects is
/// inconsistent across OS versions; this makes the behavior explicit.)
///
/// The test is scheme + host + port, not host alone (#540): a redirect that
/// keeps the hostname but drops to `http://`, or moves to another port, is a
/// different server as far as a credential is concerned.
private final class RedirectSanitizer: NSObject, URLSessionTaskDelegate {
    private let origin: CanonicalOrigin?

    init(origin: CanonicalOrigin?) {
        self.origin = origin
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        var req = request
        if let url = req.url, origin?.owns(url) != true {
            // A redirect must never forward a password or mutation body to a
            // different backend. Only credential-free download redirects pass.
            guard ["GET", "HEAD"].contains(task.originalRequest?.httpMethod ?? "GET") else {
                completionHandler(nil)
                return
            }
            req.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(req)
    }
}

/// REST client for the Flow backend. Holds the bearer token; all requests
/// are async/await over URLSession.
actor APIClient {
    private let baseURL: URL
    /// The one origin this client's bearer may be sent to. Everything else —
    /// a presigned storage URL, a cross-origin redirect, an absolute URL a
    /// caller handed in — goes out unauthenticated.
    private let origin: CanonicalOrigin?
    private var token: String?
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    /// Fired when a request that carried our bearer token comes back 401 — the
    /// session is gone server-side (expired, revoked, or the row no longer
    /// exists). SyncEngine installs a handler that tears the session down and
    /// drops to the sign-in screen.
    ///
    /// Without this, a dead session was only ever noticed at launch, in
    /// `SyncEngine.bootstrap()`. A 401 arriving mid-session propagated to
    /// whichever view made the call, so "your session expired" reached the
    /// user as "Couldn't paste image: invalid or expired token" while the rest
    /// of the app carried on looking signed in, reading from the local cache.
    private var onUnauthorized: (@Sendable () async -> Void)?
    /// One teardown per session: a dead token usually fails several in-flight
    /// requests at once (sync, thumbnails, presence) and they must not each
    /// trigger their own sign-out.
    private var reportedUnauthorized = false

    /// Bumped on every token replacement. A request captures the generation it
    /// went out under; a 401 is only believed when it still matches, so a slow
    /// request from before a refresh cannot sign out the session that replaced
    /// it (#540).
    private var generation = 0

    /// Capture this session before local logout clears the live transport.
    func revocationClient() async -> APIClient {
        let client = APIClient(baseURL: baseURL)
        await client.setToken(token)
        return client
    }

    /// `protocolClasses` is a test seam: the auth-generation guard and the
    /// "bearer only to this exact origin" rule are transport behaviour, and the
    /// only honest way to check them is to answer a real request. Nil in the
    /// app, where the default stack applies.
    init(baseURL: URL, protocolClasses: [AnyClass]? = nil) {
        self.baseURL = baseURL
        let origin = CanonicalOrigin.originOf(baseURL)
        self.origin = origin
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        if let protocolClasses { config.protocolClasses = protocolClasses }
        self.session = URLSession(
            configuration: config,
            delegate: RedirectSanitizer(origin: origin),
            delegateQueue: nil
        )
    }

    var authGeneration: Int { generation }

    /// Does this URL belong to the backend that may see our bearer?
    nonisolated func owns(_ url: URL) -> Bool {
        CanonicalOrigin.originOf(baseURL)?.owns(url) == true
    }

    @discardableResult
    func setToken(_ token: String?) -> Int {
        self.token = token
        generation += 1
        reportedUnauthorized = false
        return generation
    }

    func setUnauthorizedHandler(_ handler: (@Sendable () async -> Void)?) {
        onUnauthorized = handler
    }

    /// Report a 401 on an authenticated request, once. `sentToken` is false for
    /// requests that deliberately go out unauthenticated (a presigned R2 PUT),
    /// where a 401 says nothing about our session. `generation` is the one the
    /// request went out under: a 401 answering a pre-refresh request says
    /// nothing about the token that replaced it, so it is dropped.
    private func reportIfUnauthorized(status: Int, sentToken: Bool, generation: Int) async {
        guard status == 401, sentToken, generation == self.generation,
              !reportedUnauthorized, let onUnauthorized
        else { return }
        reportedUnauthorized = true
        await onUnauthorized()
    }

    // MARK: Convenience verbs

    func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await request("GET", path, query: query, bodyData: nil)
    }

    func post<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await request("POST", path, query: [], bodyData: nil)
    }

    func post<T: Decodable & Sendable>(_ path: String, body: some Encodable & Sendable) async throws -> T {
        try await request("POST", path, query: [], bodyData: try encoder.encode(body))
    }

    func patch<T: Decodable & Sendable>(_ path: String, body: some Encodable & Sendable) async throws -> T {
        try await request("PATCH", path, query: [], bodyData: try encoder.encode(body))
    }

    func delete<T: Decodable & Sendable>(
        _ path: String,
        query: [URLQueryItem] = []
    ) async throws -> T {
        try await request("DELETE", path, query: query, bodyData: nil)
    }

    func put<T: Decodable & Sendable>(_ path: String, body: some Encodable & Sendable) async throws -> T {
        try await request("PUT", path, query: [], bodyData: try encoder.encode(body))
    }

    func put<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await request("PUT", path, query: [], bodyData: nil)
    }

    /// Multipart file upload (single "file" field).
    func upload<T: Decodable & Sendable>(
        _ path: String, filename: String, mimeType: String, data: Data
    ) async throws -> T {
        let boundary = "flow-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename.replacingOccurrences(of: "\"", with: "_"))\"\r\n".utf8
        ))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return try await request(
            "POST", path, query: [], bodyData: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
    }

    /// PUT a file to a presigned upload target, streaming from disk — uploads
    /// can be hundreds of MB, never load them into memory. Absolute URLs (R2)
    /// must not carry our bearer token; the server-relative local-dev fallback
    /// needs it.
    func putRaw(_ target: String, headers: [String: String], fromFile fileURL: URL) async throws {
        guard let url = URL(string: target, relativeTo: baseURL) else {
            throw APIError(status: 0, code: "bad_url", message: "invalid upload URL")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        // Authenticate only when the resolved target really is on our backend.
        // The server-relative local-dev fallback needs the bearer; an external
        // presigned URL must never see it — decided by the origin, not by the
        // shape of the string we were handed.
        var sentToken = false
        if origin?.owns(url) == true, let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            sentToken = true
        }
        let generation = self.generation
        let response: URLResponse
        do {
            (_, response) = try await session.upload(for: req, fromFile: fileURL)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            await reportIfUnauthorized(status: status, sentToken: sentToken, generation: generation)
            throw APIError(status: status, code: "upload_failed", message: "upload failed (HTTP \(status))")
        }
    }

    /// Authenticated download streamed to a temporary file on disk (videos can
    /// be hundreds of MB). Follows the 302 to R2; caller must move the returned
    /// temp file before it's cleaned up.
    func downloadToFile(_ path: String) async throws -> URL {
        var req = URLRequest(url: baseURL.appending(path: path))
        let sentToken = token != nil
        let generation = self.generation
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let tmp: URL
        let response: URLResponse
        do {
            (tmp, response) = try await session.download(for: req)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            await reportIfUnauthorized(status: status, sentToken: sentToken, generation: generation)
            throw APIError(status: status, code: "http_\(status)", message: "HTTP \(status)")
        }
        return tmp
    }

    /// Authenticated raw-byte GET (file downloads, thumbnails, avatars).
    func getData(_ path: String) async throws -> Data {
        var req = URLRequest(url: baseURL.appending(path: path))
        let sentToken = token != nil
        let generation = self.generation
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            await reportIfUnauthorized(status: status, sentToken: sentToken, generation: generation)
            throw APIError(status: status, code: "http_\(status)", message: "HTTP \(status)")
        }
        return data
    }

    // MARK: Core

    private func request<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem],
        bodyData: Data?,
        contentType: String = "application/json"
    ) async throws -> T {
        guard var comps = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError(status: 0, code: "bad_url", message: "invalid URL for \(path)")
        }
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else {
            throw APIError(status: 0, code: "bad_url", message: "invalid URL for \(path)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        let sentToken = token != nil
        let generation = self.generation
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let bodyData {
            req.httpBody = bodyData
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            await reportIfUnauthorized(status: status, sentToken: sentToken, generation: generation)
            if let env = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(status: status, code: env.error.code, message: env.error.message)
            }
            throw APIError(status: status, code: "http_\(status)", message: "HTTP \(status)")
        }
        return try decoder.decode(T.self, from: data)
    }
}
