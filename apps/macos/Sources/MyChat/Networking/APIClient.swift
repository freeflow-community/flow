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

/// REST client for the MyChat backend. Holds the bearer token; all requests
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
        self.session = URLSession(configuration: config)
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
        let boundary = "mychat-\(UUID().uuidString)"
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
