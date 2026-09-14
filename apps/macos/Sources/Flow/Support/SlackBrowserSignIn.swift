import AuthenticationServices
import CryptoKit
import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Connect a Slack team through the Flow Slack connector, natively (#546).
/// Mirrors the web client's flow (packages/web/src/lib/slackConnector.ts):
/// the connector starts the authorization with our S256 challenge, Slack's
/// consent page runs in the system web-auth session, the connector's callback
/// returns to `flow://slack/connected?operationId=…`, and the credential is
/// redeemed by polling with the private verifier — never from the URL.
///
/// The connector must list `flow://slack` in CONNECTOR_CLIENT_ORIGINS; the
/// client origin is a label for the return address, not a credential.
@MainActor
final class SlackBrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let clientOrigin = "flow://slack"

    struct Identity: Decodable, Equatable, Sendable {
        let environment: String
        let enterpriseId: String?
        let teamId: String
        let userId: String
    }

    /// What the connector hands back once consent completes.
    struct Handoff: Decodable, Sendable {
        let status: String
        let credential: String?
        let grantId: String?
        let identity: Identity?
        let teamName: String?
        let userName: String?
        let scopes: [String]?
        let capabilities: [String: Bool]?
        let grantStatus: String?
    }

    enum Failure: Error, Equatable {
        case connector(String)
        case notSlack
        case canceled
        case expired
        case status(String)
        case identity

        var message: String {
            switch self {
            case .connector(let text): return text
            case .notSlack: return "Invalid Slack authorization destination."
            case .canceled: return "Slack sign-in was canceled."
            case .expired: return "Slack sign-in timed out. Try Connect Slack again."
            case .status(let code): return SlackBrowserSignIn.statusMessage(code)
            case .identity: return "Invalid Slack identity."
            }
        }
    }

    /// Same wording as the web client's `slackStatusMessage`.
    nonisolated static func statusMessage(_ status: String) -> String {
        switch status {
        case "authorization_expired": return "Slack sign-in timed out. Try Connect Slack again."
        case "canceled": return "Slack sign-in was canceled."
        case "consent_denied": return "Slack consent was denied."
        case "approval_required": return "Your Slack administrator must approve this app."
        case "approval_denied": return "Slack workspace app approval was denied."
        case "wrong_team": return "A different Slack team was authorized. Retry with the intended team."
        case "missing_scopes": return "Connected with limited permissions. Reauthorize to grant the missing permissions."
        case "revoked": return "Slack access was revoked. Reauthorize this connection."
        case "app_removed": return "The Slack app was removed from this team."
        case "account_deactivated": return "This Slack account is deactivated."
        case "reauthorization_required": return "Slack authorization expired. Reauthorize this connection."
        case "rotation_required": return "Enable token rotation on the Slack app before connecting."
        case "enterprise_grant_unsupported": return "Connect an individual Slack workspace; organization-wide grants are not supported yet."
        default: return "Slack connector: \(status.replacingOccurrences(of: "_", with: " "))."
        }
    }

    private var session: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApp.keyWindow ?? ASPresentationAnchor()
        #else
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        #endif
    }

    private func opaque() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return encode(Data(bytes))
    }

    private func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// `connector` is the HTTPS connector origin; `expectedTeamId` pins a
    /// reauthorization to the team already recorded.
    func connect(connector: URL, expectedTeamId: String? = nil) async throws -> Handoff {
        let verifier = opaque()
        let challenge = encode(Data(SHA256.hash(data: Data(verifier.utf8))))
        let transport = URLSession(configuration: .ephemeral)
        defer { transport.invalidateAndCancel(); session = nil }
        func post(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
            var request = URLRequest(url: connector.appending(path: path))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await transport.data(for: request)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw Failure.connector(Self.statusMessage(json["error"] as? String ?? "request_failed"))
            }
            return json
        }
        var startBody: [String: Any] = ["challenge": challenge, "clientOrigin": Self.clientOrigin]
        if let expectedTeamId { startBody["expectedTeamId"] = expectedTeamId }
        let start = try await post("v1/oauth/start", startBody)
        guard let authorization = (start["authorizationUrl"] as? String).flatMap(URL.init(string:)),
              let operationId = start["operationId"] as? String else { throw Failure.connector("Slack connector: bad start reply.") }
        guard authorization.scheme == "https", authorization.host == "slack.com", authorization.path == "/oauth/v2/authorize" else { throw Failure.notSlack }
        // The callback carries only the operation id; consent may also end
        // without a callback (closed sheet), which polling reports as expiry.
        do {
            _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let browser = ASWebAuthenticationSession(url: authorization, callbackURLScheme: "flow") { callback, error in
                    if let callback { continuation.resume(returning: callback) }
                    else { continuation.resume(throwing: error ?? URLError(.cancelled)) }
                }
                browser.presentationContextProvider = self
                browser.prefersEphemeralWebBrowserSession = false
                session = browser
                if !browser.start() { continuation.resume(throwing: URLError(.cancelled)) }
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw Failure.canceled
        } catch { /* A missing callback is not proof of cancellation; poll decides. */ }
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            let poll = try await post("v1/oauth/poll", ["verifier": verifier, "operationId": operationId, "clientOrigin": Self.clientOrigin])
            let status = poll["status"] as? String ?? "pending"
            if status != "pending" {
                let handoff = try JSONDecoder().decode(Handoff.self, from: JSONSerialization.data(withJSONObject: poll))
                guard handoff.credential != nil, ["connected", "missing_scopes"].contains(handoff.status) else { throw Failure.status(handoff.status) }
                guard let identity = handoff.identity, identity.environment == "slack",
                      Self.isSlackId(identity.teamId), Self.isSlackId(identity.userId) else { throw Failure.identity }
                return handoff
            }
            try await Task.sleep(for: .seconds(1))
        }
        throw Failure.expired
    }

    nonisolated static func isSlackId(_ value: String) -> Bool {
        value.range(of: "^[A-Z][A-Z0-9]+$", options: .regularExpression) != nil
    }
}
