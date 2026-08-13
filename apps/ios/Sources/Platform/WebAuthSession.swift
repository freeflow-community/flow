import AuthenticationServices
import UIKit

/// In-app web sign-in (App Store Guideline 4 — review rejected flows that
/// open the default browser). Wraps ASWebAuthenticationSession so web-backed
/// auth (the Google handoff page) runs in an in-app sheet instead of Safari.
/// The sheet ends when the page navigates to `flow://signin?code=…` — the
/// same handoff the browser flow used, so the server and web pages are
/// untouched.
@MainActor
enum WebAuthSession {
    /// The session must stay strongly referenced while it runs, and its
    /// presentation-context provider is held weakly — park both here.
    private static var active: (ASWebAuthenticationSession, Presenter)?

    /// Opens `url` in the auth sheet and returns the one-time app-link code
    /// from the `flow://signin` callback, or nil when the user cancels.
    static func signInCode(startingAt url: URL) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "flow"
            ) { callback, error in
                Task { @MainActor in Self.active = nil }
                if let error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(returning: nil)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }
                let code = callback.flatMap {
                    URLComponents(url: $0, resolvingAgainstBaseURL: false)?
                        .queryItems?.first { $0.name == "code" }?.value
                }
                continuation.resume(returning: code)
            }
            let presenter = Presenter()
            session.presentationContextProvider = presenter
            // Share Safari's cookies: someone already signed in on the web
            // gets a one-tap handoff instead of a second Google prompt.
            session.prefersEphemeralWebBrowserSession = false
            active = (session, presenter)
            if !session.start() {
                active = nil
                continuation.resume(returning: nil)
            }
        }
    }

    private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
