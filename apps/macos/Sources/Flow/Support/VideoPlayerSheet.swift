import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Plays an unfurl card's video without leaving Flow (#302) — shared by the
/// macOS and iOS message lists, like UnfurlCardView itself.
///
/// The frame's URL is `Unfurl.Embed.playerUrl`, which the *server* built from
/// the video id it parsed; the provider's own oEmbed HTML is discarded before
/// it ever reaches a client. Nothing here is loaded until the viewer taps play,
/// and the web view uses a non-persistent data store on top of the server's
/// cookieless player host, so watching a link in a chat leaves nothing behind.
struct VideoPlayerSheet: View {
    let embed: Unfurl.Embed
    let title: String?
    /// The page the card points at — the escape hatch when a video refuses to
    /// play embedded (owners can disable embedding).
    let target: String

    @Environment(\.dismiss) private var dismiss

    private var playerURL: URL? {
        // `playerUrl` is documented to carry no query, so `?` is safe here.
        URL(string: "\(embed.playerUrl)?autoplay=1&playsinline=1&rel=0")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(title ?? "Video")
                    .flowFont(.callout, weight: .semibold)
                    .foregroundStyle(MC.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button("Open in browser") { openTarget() }
                    .buttonStyle(.plain)
                    .flowFont(.caption)
                    .foregroundStyle(MC.accentSoft)
                    .accessibilityIdentifier("unfurl.player.openExternal")
                Button("Done") { dismiss() }
                    .buttonStyle(.plain)
                    .flowFont(.caption, weight: .semibold)
                    .foregroundStyle(MC.accentSoft)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("unfurl.player.done")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            if let playerURL {
                EmbeddedVideoWebView(url: playerURL)
                    .background(Color.black)
                    .accessibilityIdentifier("unfurl.player")
            } else {
                Text("This video can't be played here.")
                    .flowFont(.callout)
                    .foregroundStyle(MC.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(MC.base)
        #if os(macOS)
        .frame(width: 760, height: 470)
        #endif
    }

    private func openTarget() {
        guard let url = URL(string: target) else { return }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
        dismiss()
    }
}

/// The page the player web view actually loads (#318).
///
/// An embedded player has to be *embedded*: navigating the web view straight
/// at the embed URL makes it the top-level document, which arrives at YouTube
/// with no `Referer` and no embedding origin, and YouTube answers that with
/// "Error 153 — video player configuration error". The web client never hit
/// this because its `<iframe>` sits inside the web app's page. So the native
/// clients get a page of their own to sit inside.
///
/// It is *our* markup, built here from the URL the server assembled out of the
/// parsed video id — the provider's own oEmbed HTML is still discarded on the
/// server (#302) and nothing provider-supplied is interpolated.
enum VideoPlayerPage {
    /// The origin the wrapper page claims, and therefore the referrer YouTube
    /// sees. Deliberately the web client's real origin and deliberately a
    /// constant: a dev build points `Server.baseURL` at `http://127.0.0.1`,
    /// which is not an origin worth asking a third-party player to accept, and
    /// a player that only works in production builds is a trap.
    static let embeddingOrigin = URL(string: "https://app.freeflow.im/")!

    /// A minimal page holding one iframe. `playsinline`/`allow="autoplay"`
    /// keep iOS playing in place instead of taking the screen over.
    static func html(playerSrc: String) -> String {
        let src = escaped(playerSrc)
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <meta name="referrer" content="strict-origin-when-cross-origin">
        <style>
        html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
        iframe { display: block; width: 100%; height: 100%; border: 0; }
        </style>
        </head>
        <body>
        <iframe src="\(src)"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowfullscreen
                frameborder="0"></iframe>
        </body>
        </html>
        """
    }

    /// Attribute escaping, so a URL can never close the attribute and open a
    /// tag. The id is already bounded to `[A-Za-z0-9_-]` on the server; this is
    /// the second lock, held on the side that does the interpolating.
    static func escaped(_ value: String) -> String {
        var out = ""
        out.reserveCapacity(value.count)
        for char in value {
            switch char {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            case "'": out += "&#39;"
            default: out.append(char)
            }
        }
        return out
    }
}

/// A bare, ephemeral WKWebView holding the wrapper page. Same shape as the
/// mermaid and artifact web views: no persistence, no bridge, nothing to
/// script.
@MainActor
private func makePlayerWebView() -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.mediaTypesRequiringUserActionForPlayback = []
    #if os(iOS)
    config.allowsInlineMediaPlayback = true
    #endif
    return WKWebView(frame: .zero, configuration: config)
}

@MainActor
private func loadPlayer(_ view: WKWebView, url: URL) {
    view.loadHTMLString(
        VideoPlayerPage.html(playerSrc: url.absoluteString),
        baseURL: VideoPlayerPage.embeddingOrigin
    )
}

#if os(iOS)
private struct EmbeddedVideoWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let view = makePlayerWebView()
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        context.coordinator.loaded = url
        loadPlayer(view, url: url)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        loadPlayer(view, url: url)
    }

    func makeCoordinator() -> LoadedURL { LoadedURL() }
}
#else
private struct EmbeddedVideoWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let view = makePlayerWebView()
        context.coordinator.loaded = url
        loadPlayer(view, url: url)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        loadPlayer(view, url: url)
    }

    func makeCoordinator() -> LoadedURL { LoadedURL() }
}
#endif

/// What the web view was last asked to play. `view.url` used to answer this,
/// but a wrapper page reports the *base* URL, which is the same for every
/// video — without this, switching videos in a reused web view would show the
/// first one forever.
@MainActor
final class LoadedURL {
    var loaded: URL?
}
