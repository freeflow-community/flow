// Mini apps (docs/design/MINI_APPS.md): the decisions the artifact panel's
// mini-browser has to make about an app artifact — whether opening it needs a
// mint at all, whether a navigation it just committed is a member browsing, and
// whether a url it is about to broadcast is carrying a minted token.
//
// Attaching the token is *not* here: that is `withAppToken(_:token:)` in
// Support/AppToken.swift, shared with iOS (issue #373).
//
// These are shared by macOS and iOS, which is the point: both render apps inline
// in a co-browsing web view, and a rule that lived in one client's view file
// would drift out of the other's within a release (issue #380).
//
// Why a *top-level* web view is enough on either, when the web client's iframe is
// not: the #371 spike measured WebKit refusing the guard's `SameSite=None`
// cookie in a cross-site frame, which is why web routes Safari to a new tab.
// Both apps load the app as a top-level document in their own web view, so the
// guard's cookie is first-party and that restriction doesn't apply — measured
// live in a real iOS WKWebView during #373.
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
    /// `isApp` short-circuits the whole question (issue #380). An app is
    /// *opened*, never co-browsed: each viewer mints their own token and lands
    /// on their own session, so one member's navigation inside it is not a page
    /// anyone else can be moved to. Broadcasting it re-points the shared
    /// artifact for every member of the channel — which is exactly the bug this
    /// flag closes, and its silent variant (the guard's own 302 rewriting the
    /// shared url on every open) is a data bug rather than a visible one.
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
    static func isMemberNavigation(
        committed: String, isApp: Bool, isOwnLoad: Bool, lastLoaded: String?
    ) -> Bool {
        guard !isApp else { return false }
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

    /// The last gate before a url becomes the artifact's shared url.
    ///
    /// `isMemberNavigation` already refuses to report an app's navigations, so
    /// in the web view's path this is belt to that braces — deliberately, since
    /// the two clients each own a navigation delegate and the cost of one of
    /// them forgetting is every member's viewer being re-pointed. It also
    /// covers the path the delegate never sees: typing in the address bar.
    static func canBroadcast(_ url: String, isApp: Bool) -> Bool {
        guard !isApp else { return false }
        // A minted token belongs to one viewer and is burned on first use, so it
        // must never become the shared url. Unreachable for an app now, but a
        // plain link that happens to carry the parameter is still refused.
        return !carriesToken(url)
    }
}
