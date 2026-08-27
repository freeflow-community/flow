import Foundation

/// Attach a minted identity token to a mini app's url (`docs/design/MINI_APPS.md`).
///
/// `URLComponents` rather than string concatenation, so an app url that already
/// carries a query or a fragment survives intact and a stale `flow_token` is
/// replaced rather than doubled. The guard reads `flow_token` out of the query,
/// opens a session, and 302s to the url without it — so the token never sticks
/// around in the address bar, and the artifact's shared url is never touched.
///
/// Returns nil when the url can't be parsed. The server normalizes link urls so
/// this shouldn't happen, but a token that can't be attached means an app that
/// can't be opened — the caller surfaces that rather than opening a url the
/// guard would refuse.
func withAppToken(_ url: String, token: String) -> URL? {
    guard var c = URLComponents(string: url), c.scheme != nil else { return nil }
    var items = (c.queryItems ?? []).filter { $0.name != "flow_token" }
    items.append(URLQueryItem(name: "flow_token", value: token))
    c.queryItems = items
    return c.url
}
