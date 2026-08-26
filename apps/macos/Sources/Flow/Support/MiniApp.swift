// Mini apps (docs/design/MINI_APPS.md): the two decisions the artifact panel's
// mini-browser has to make about an app artifact — whether opening it needs a
// mint at all, and whether a url it is about to broadcast is carrying a minted
// token.
//
// Attaching the token is *not* here: that is `withAppToken(_:token:)` in
// Support/AppToken.swift, shared with iOS (issue #373).
//
// These two are macOS-only because co-browse is: the panel broadcasts every
// navigation to the whole channel, which no other client does.
//
// Why a *top-level* web view is enough on macOS, when the web client's iframe is
// not: the #371 spike measured WebKit refusing the guard's `SameSite=None`
// cookie in a cross-site frame, which is why web routes Safari to a new tab.
// The artifact panel loads the app as a top-level document in its own web view,
// so the guard's cookie is first-party and that restriction doesn't apply.
//
// The guard handshake this relies on is verified against the real
// `flow-agent-bridge app-guard` behind an https tunnel (issue #372): the mint
// 302s to the clean url with a session cookie, a replayed token gets 401, and
// — load-bearing for `carriesToken` below — that 401 carries no `Location`, so
// the tokened url stays committed in the web view.
import Foundation

enum MiniApp {
    /// The query parameter the guard reads the one-time token out of, and strips
    /// with its 302 to the clean url. Same name `withAppToken(_:token:)`
    /// attaches — this side only has to recognise it.
    static let tokenParam = "flow_token"

    /// What the mini-browser should do with a link artifact's url.
    enum LoadPlan: Equatable {
        /// Nothing pinned yet.
        case idle
        /// A plain link: load this url as-is, exactly as before mini apps existed.
        case load(String)
        /// An app: mint an identity token first, then load `withAppToken(url:…)`.
        /// Until the mint returns, nothing is loaded — a failed mint must never
        /// put a request on the app's tunnel, where the guard would only answer
        /// its 401 page.
        case mint
    }

    static func plan(url: String, isApp: Bool) -> LoadPlan {
        guard !url.isEmpty else { return .idle }
        return isApp ? .mint : .load(url)
    }

    /// True when this url is carrying a minted token.
    ///
    /// Load-bearing for co-browse: a tokened url belongs to one viewer and is
    /// burned on first use, so it must never become the artifact's shared url.
    /// That is not hypothetical — when the guard rejects a token (replayed, or
    /// expired because the panel sat open) it answers 401 *without* redirecting,
    /// so the web view commits the tokened url and the navigation delegate would
    /// otherwise broadcast it to every member.
    static func carriesToken(_ url: String) -> Bool {
        guard let parts = URLComponents(string: url) else {
            return url.contains("\(tokenParam)=")
        }
        return parts.queryItems?.contains { $0.name == tokenParam } ?? false
    }
}
