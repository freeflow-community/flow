import Foundation

/// Canonical origin for a Flow backend, and the rules that decide when two
/// addresses are the same server (docs/specs/multi-server-workspaces.md,
/// "Connection and identity model").
///
/// Its own file, and deliberately dependency-free beyond `BuildInfo`, because
/// `APIClient` needs it and the iOS share extension compiles `APIClient`
/// without the rest of the connection registry — that process has a ~120 MB
/// ceiling and no business carrying a registry it never reads.

enum ServerOriginError: Error, Equatable {
    case empty
    case unparseable
    case schemeNotSupported
    case insecure
    case userinfoNotAllowed
    case pathNotAllowed
    case queryNotAllowed
    case fragmentNotAllowed
    case hostMissing

    /// What the user sees next to the server-address field.
    var message: String {
        switch self {
        case .empty, .hostMissing: "Enter a server address."
        case .unparseable: "That is not a valid server address."
        case .schemeNotSupported, .insecure: "A Flow server must be reachable over https://."
        case .userinfoNotAllowed: "Remove the username and password from the server address."
        case .pathNotAllowed: "Flow must be served at the root of its own domain — remove the path."
        case .queryNotAllowed: "A server address cannot include a query string."
        case .fragmentNotAllowed: "A server address cannot include a fragment."
        }
    }
}

/// A Flow backend's identity as far as this client is concerned. Two addresses
/// name the same server exactly when their canonical origins are equal, so
/// every comparison — "is this already connected", "may this URL carry our
/// bearer" — goes through here rather than string-matching URLs.
struct CanonicalOrigin: Equatable, Sendable {
    /// `https://flow.example.com` or `http://127.0.0.1:8787`, no trailing slash.
    let origin: String
    let scheme: String
    /// Lowercased host.
    let host: String
    /// The port actually dialed, default included.
    let effectivePort: Int

    var url: URL { URL(string: origin)! }

    static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1", "[::1]"]

    static func isLoopback(_ host: String) -> Bool {
        loopbackHosts.contains(host.lowercased())
    }

    /// V1 requires an origin-root deployment. Userinfo, a query, a fragment or
    /// a path is rejected rather than trimmed: those forms usually mean an
    /// invite link or a reverse-proxy subpath was pasted, and quietly dropping
    /// the part that made it wrong would point credentials at a server the user
    /// did not name.
    ///
    /// HTTPS is required. HTTP on loopback is an explicit development
    /// allowance; certificate validation is never bypassed.
    static func normalize(
        _ input: String,
        allowInsecureLoopback: Bool = BuildInfo.isDebugBuild
    ) throws -> CanonicalOrigin {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { throw ServerOriginError.empty }
        // A bare host is the common typed form; default it to HTTPS rather than
        // rejecting it. An explicit scheme is kept, so "http://example.com"
        // still fails the HTTPS check below instead of being silently upgraded.
        let withScheme = raw.contains("://") ? raw : "https://\(raw)"
        guard let comps = URLComponents(string: withScheme) else {
            throw ServerOriginError.unparseable
        }
        guard let scheme = comps.scheme?.lowercased() else { throw ServerOriginError.unparseable }
        guard scheme == "http" || scheme == "https" else { throw ServerOriginError.schemeNotSupported }
        guard comps.user == nil, comps.password == nil else { throw ServerOriginError.userinfoNotAllowed }
        guard comps.query == nil else { throw ServerOriginError.queryNotAllowed }
        guard comps.fragment == nil else { throw ServerOriginError.fragmentNotAllowed }
        guard comps.path.isEmpty || comps.path == "/" else { throw ServerOriginError.pathNotAllowed }
        guard let rawHost = comps.host, !rawHost.isEmpty else { throw ServerOriginError.hostMissing }
        let host = rawHost.lowercased()

        if scheme == "http", !(allowInsecureLoopback && isLoopback(host)) {
            throw ServerOriginError.insecure
        }

        let defaultPort = scheme == "https" ? 443 : 80
        let effectivePort = comps.port ?? defaultPort
        let hostPart = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let origin = effectivePort == defaultPort
            ? "\(scheme)://\(hostPart)"
            : "\(scheme)://\(hostPart):\(effectivePort)"
        return CanonicalOrigin(origin: origin, scheme: scheme, host: host, effectivePort: effectivePort)
    }

    /// The origin a URL sits on, ignoring its path, query and fragment.
    ///
    /// Deliberately *not* `normalize`: that one validates a server address a
    /// human typed, where a path is a mistake worth refusing. This one answers
    /// "which server is this URL on" for a URL we are already holding — an API
    /// request, a redirect target, the configured backend — where the path is
    /// the point. The HTTPS policy is relaxed for the same reason: the address
    /// was accepted at configuration time, and a dev build's
    /// `http://127.0.0.1:8787` must still match itself in a release binary's
    /// test suite.
    static func originOf(_ url: URL) -> CanonicalOrigin? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let rawHost = url.host, !rawHost.isEmpty
        else { return nil }
        let host = rawHost.lowercased()
        let defaultPort = scheme == "https" ? 443 : 80
        let effectivePort = url.port ?? defaultPort
        let hostPart = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let origin = effectivePort == defaultPort
            ? "\(scheme)://\(hostPart)"
            : "\(scheme)://\(hostPart):\(effectivePort)"
        return CanonicalOrigin(origin: origin, scheme: scheme, host: host, effectivePort: effectivePort)
    }

    /// Is `url` on exactly this origin — the test the bearer attaches on?
    /// Scheme, host *and* port must match: a redirect to another port is a
    /// different server as far as credentials go, and a presigned storage URL
    /// is never ours.
    func owns(_ url: URL) -> Bool {
        CanonicalOrigin.originOf(url)?.origin == origin
    }

    /// `wss://…/v1/ws` on this backend.
    var socketURL: URL {
        var c = URLComponents(string: origin)!
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = "/v1/ws"
        return c.url!
    }

    /// Short label ("flow.example.com", "127.0.0.1:8787").
    var label: String {
        effectivePort == (scheme == "https" ? 443 : 80) ? host : "\(host):\(effectivePort)"
    }
}
