// Mini apps (docs/design/MINI_APPS.md): the decisions the artifact panel's
// mini-browser has to make about an app artifact — whether opening it needs a
// mint at all, whether a navigation it just committed is a member browsing, and
// whether a url it is about to broadcast is carrying a minted token.
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
        /// Load this url as-is: a plain link, exactly as before mini apps
        /// existed, or an app the guard has already let us into.
        case load(String)
        /// An app, first time in: mint an identity token, then load
        /// `withAppToken(url:…)`. Until the mint returns, nothing is loaded — a
        /// failed mint must never put a request on the app's tunnel, where the
        /// guard would only answer its 401 page.
        case mint
    }

    /// `hasAppSession` is the load-bearing argument: an app mints once per
    /// *open*, not once per url.
    ///
    /// After the guard redirects the tokened url to the clean one it has set a
    /// session cookie, and every page after that is authenticated by the cookie.
    /// Re-minting whenever the shared url changes would spend a token per
    /// co-browse hop and reload the app from scratch — losing whatever state the
    /// member had in it — which is not a hypothetical: measured against the real
    /// guard, one open produced two mints 25ms apart and cancelled the app's
    /// in-flight subresources (see `isMemberNavigation`, the other half of it).
    static func plan(url: String, isApp: Bool, hasAppSession: Bool = false) -> LoadPlan {
        guard !url.isEmpty else { return .idle }
        guard isApp else { return .load(url) }
        return hasAppSession ? .load(url) : .mint
    }

    /// Whether a navigation the web view just committed is a *member browsing*,
    /// and so something to co-browse to the rest of the channel.
    ///
    /// `isOwnLoad` is what the url strings cannot tell you. The panel loads an
    /// app's tokened url; the guard answers 302 and the web view commits the
    /// clean one — a url we never asked for, which reads exactly like a member
    /// having clicked something. Broadcasting it re-points the artifact, and the
    /// re-point comes straight back as a url change that mints a second token.
    /// Matching the committed `WKNavigation` against the one `load` returned
    /// says "this is still our load, wherever it ended up", which is the only
    /// thing that distinguishes the two.
    ///
    /// It also settles a pre-existing echo on plain links: the server normalises
    /// `https://host` to `https://host/`, so the panel's own opening load used to
    /// re-point the artifact onto a url that differed by one character.
    static func isMemberNavigation(committed: String, isOwnLoad: Bool, lastLoaded: String?) -> Bool {
        guard !isOwnLoad else { return false }
        return committed != lastLoaded
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
