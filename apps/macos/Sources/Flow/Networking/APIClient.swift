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
}

/// Strips the Authorization header when a redirect leaves the API host — the
/// server 302s file downloads to presigned R2 URLs, and S3-style endpoints
/// reject requests carrying both a signed query string and an Authorization
/// header. (CFNetwork's own header handling on redirects is inconsistent
/// across OS versions; this makes the behavior explicit.)
private final class RedirectSanitizer: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        var req = request
        if req.url?.host != task.originalRequest?.url?.host {
            req.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(req)
    }
}

/// REST client for the Flow backend. Holds the bearer token; all requests
/// are async/await over URLSession.
actor APIClient {
    private let baseURL: URL
    private var token: String?
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config, delegate: RedirectSanitizer(), delegateQueue: nil)
    }

    func setToken(_ token: String?) {
        self.token = token
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

    func delete<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await request("DELETE", path, query: [], bodyData: nil)
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
        if target.hasPrefix("/"), let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let response: URLResponse
        do {
            (_, response) = try await session.upload(for: req, fromFile: fileURL)
        } catch {
            throw APIError(status: 0, code: "network", message: error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError(status: status, code: "upload_failed", message: "upload failed (HTTP \(status))")
        }
    }

    /// Authenticated download streamed to a temporary file on disk (videos can
    /// be hundreds of MB). Follows the 302 to R2; caller must move the returned
    /// temp file before it's cleaned up.
    func downloadToFile(_ path: String) async throws -> URL {
        var req = URLRequest(url: baseURL.appending(path: path))
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let tmp: URL
        let response: URLResponse
        do {
            (tmp, response) = try await session.download(for: req)
        } catch {
            throw APIError(status: 0, code: "network", message: error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError(status: status, code: "http_\(status)", message: "HTTP \(status)")
        }
        return tmp
    }

    /// Authenticated raw-byte GET (file downloads, thumbnails, avatars).
    func getData(_ path: String) async throws -> Data {
        var req = URLRequest(url: baseURL.appending(path: path))
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError(status: 0, code: "network", message: error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
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
            throw APIError(status: 0, code: "network", message: error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if let env = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(status: status, code: env.error.code, message: env.error.message)
            }
            throw APIError(status: status, code: "http_\(status)", message: "HTTP \(status)")
        }
        return try decoder.decode(T.self, from: data)
    }
}
