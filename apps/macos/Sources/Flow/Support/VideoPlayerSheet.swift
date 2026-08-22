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

/// A bare, ephemeral WKWebView pointed at one URL. Same shape as the mermaid
/// and artifact web views: no persistence, no bridge, nothing to script.
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

#if os(iOS)
private struct EmbeddedVideoWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let view = makePlayerWebView()
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard view.url != url else { return }
        view.load(URLRequest(url: url))
    }
}
#else
private struct EmbeddedVideoWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let view = makePlayerWebView()
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard view.url != url else { return }
        view.load(URLRequest(url: url))
    }
}
#endif
