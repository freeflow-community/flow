import SwiftUI
import WebKit

/// A ```mermaid block in a message body, drawn as a diagram (#229).
///
/// Mermaid is a JavaScript library, so there is no native renderer to write:
/// this hosts the *same* page the web client hosts — `/mermaid/sandbox.html`,
/// served by the workspace's own server — in an ephemeral `WKWebView`. One
/// renderer, one mermaid version, one set of diagram bugs for all three
/// clients, and a new mermaid release reaches macOS and iOS the moment the
/// server deploys, with no app release.
///
/// The isolation is the same as on web. The web view has a non-persistent data
/// store (no cookies, no credentials), the diagram source is passed in by
/// `evaluateJavaScript` as JSON rather than pasted into markup, and the page
/// runs mermaid with `securityLevel: 'strict'` and HTML labels off. The SVG
/// never leaves the web view; only a height comes back.
///
/// It lives in `Support/` rather than `Views/` because that is the directory
/// `apps/ios/project.yml` shares with the macOS target — the same reason
/// `MarkdownBlocks` lives here. The two platform bridges differ only in
/// `NSViewRepresentable` vs `UIViewRepresentable`.
struct MermaidDiagramView: View {
    let source: String

    /// The host's own bound on a web view that never answers — the page
    /// failing to load (offline, an old server) or a parse hanging before the
    /// sandbox's own timer can fire.
    private static let replyTimeout: TimeInterval = 8

    @State private var height: CGFloat = 24
    @State private var failure: String?
    @State private var zoomed = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                if let failure {
                    Text("Mermaid: \(failure)")
                        .flowFont(size: 11)
                        .foregroundStyle(MC.danger)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("msg.mermaidError")
                }
                Spacer(minLength: 4)
                if failure == nil {
                    // The click that zooms is reported by the page, so it is
                    // out of reach of the keyboard and of VoiceOver. This is
                    // the way in for both.
                    Button { zoomed = true } label: {
                        Text("Zoom").flowFont(size: 11).foregroundStyle(MC.inkSoft)
                    }
                    .buttonStyle(.plain)
                    .help("Zoom diagram")
                    .accessibilityIdentifier("msg.mermaidZoom")
                }
                copyButton
            }
            if failure == nil {
                MermaidWebView(
                    source: source,
                    dark: colorScheme == .dark,
                    onHeight: { height = max($0, 24) },
                    onFailure: { failure = $0 },
                    onActivate: { zoomed = true }
                )
                .frame(height: height)
                .accessibilityIdentifier("msg.mermaidDiagram")
            } else {
                // Invalid syntax falls back to what the author wrote. The
                // diagram is unreadable; the message must not be.
                codeFallback
            }
        }
        .sheet(isPresented: $zoomed) {
            MermaidZoomView(source: source, dark: colorScheme == .dark)
        }
        .task(id: source) {
            // A body edit re-renders from scratch, so a fixed diagram stops
            // showing the old diagram's error.
            failure = nil
            zoomed = false
            try? await Task.sleep(nanoseconds: UInt64(Self.replyTimeout * 1_000_000_000))
            if height <= 24, failure == nil { failure = "The diagram renderer did not answer." }
        }
    }

    private var copyButton: some View { MermaidCopyButton(source: source) }

    /// The fallback is an ordinary code block, so it gets the ordinary code
    /// block's copy button too (#260) — the same text as `copyButton` above it,
    /// but a reader looking at a block should not have to notice that.
    @ViewBuilder
    private var codeFallback: some View {
        #if os(iOS)
        ScrollView(.horizontal, showsIndicators: false) {
            Text(source)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(MC.ink)
                .padding(.leading, 10)
                .padding(.trailing, 36)
                .padding(.vertical, 8)
        }
        .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
        .overlay(alignment: .bottomTrailing) { CodeCopyButton(source: source).padding(4) }
        .accessibilityIdentifier("msg.codeBlock")
        #else
        Text(source)
            .flowFont(size: 12, design: .monospaced)
            .foregroundStyle(MC.ink)
            .textSelection(.enabled)
            .padding(.leading, 10)
            .padding(.trailing, 36)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
            .overlay(alignment: .bottomTrailing) { CodeCopyButton(source: source).padding(4) }
            .accessibilityIdentifier("msg.codeBlock")
        #endif
    }

}

/// Copies the diagram source, with a moment of "Copied" feedback. A diagram
/// hides its source completely, so this is the only way to reach something the
/// reader cannot otherwise see — which is why it is also in the zoom overlay.
struct MermaidCopyButton: View {
    let source: String
    @State private var copied = false

    var body: some View {
        Button {
            #if os(iOS)
            UIPasteboard.general.string = source
            #else
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(source, forType: .string)
            #endif
            copied = true
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                copied = false
            }
        } label: {
            Text(copied ? "Copied" : "Copy source")
                .flowFont(size: 11)
                .foregroundStyle(MC.inkSoft)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("msg.mermaidCopy")
    }
}

/// The zoomed diagram (#232), presented by the *native* host rather than by
/// the page. The inline web view is sized to the diagram's own height, so an
/// overlay drawn inside it could never be larger than the thing it enlarges.
/// This is the same `.sheet` the image and video lightboxes use, holding a
/// second web view of the same sandbox page with `fit: "window"`.
struct MermaidZoomView: View {
    let source: String
    let dark: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?

    #if !os(iOS)
    /// As large as the window it opens over. A fixed size is the wrong answer:
    /// a wide diagram already fills the message column, so a sheet narrower
    /// than that column would *shrink* the thing the reader asked to enlarge.
    /// macOS clamps a sheet to its parent window, which makes "the window"
    /// the largest honest ask. `mainWindow` first — once the sheet is up it is
    /// the key window, and the parent is the main one.
    private var frameSize: CGSize {
        let host = NSApp.mainWindow ?? NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible }
        let bounds = host?.frame.size ?? NSScreen.main?.visibleFrame.size ?? CGSize(width: 1000, height: 700)
        return CGSize(width: max(640, bounds.width - 48), height: max(420, bounds.height - 72))
    }
    #endif

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                if let failure {
                    Text("Mermaid: \(failure)")
                        .flowFont(size: 11)
                        .foregroundStyle(MC.danger)
                        .accessibilityIdentifier("mermaidLightbox.error")
                }
                Spacer(minLength: 4)
                MermaidCopyButton(source: source)
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .help("Close")
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("mermaidLightbox.close")
            }
            MermaidWebView(
                source: source,
                dark: dark,
                fit: "window",
                onHeight: { _ in },
                onFailure: { failure = $0 },
                // The page reports a click beside the diagram, and Escape
                // pressed while the pointer is over the web view — neither
                // reaches this view on its own.
                onDismiss: { dismiss() }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(14)
        #if !os(iOS)
        .frame(width: frameSize.width, height: frameSize.height)
        #endif
        .accessibilityIdentifier("mermaidLightbox")
    }
}

/// The sandbox URL on the workspace's own server.
private var sandboxURL: URL {
    Server.baseURL.appendingPathComponent("mermaid/sandbox.html")
}

/// Shared coordinator: takes the page's replies and re-renders on source or
/// theme change. Identical on both platforms, so it sits outside the
/// representables.
private final class MermaidCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var source: String
    var dark: Bool
    /// "window" for the zoom overlay; nil for an inline diagram.
    let fit: String?
    let onHeight: (CGFloat) -> Void
    let onFailure: (String) -> Void
    let onActivate: () -> Void
    let onDismiss: () -> Void
    weak var webView: WKWebView?
    private var loaded = false

    init(
        source: String,
        dark: Bool,
        fit: String?,
        onHeight: @escaping (CGFloat) -> Void,
        onFailure: @escaping (String) -> Void,
        onActivate: @escaping () -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.source = source
        self.dark = dark
        self.fit = fit
        self.onHeight = onHeight
        self.onFailure = onFailure
        self.onActivate = onActivate
        self.onDismiss = onDismiss
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        render()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onFailure("The diagram renderer could not be loaded.")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onFailure("The diagram renderer could not be loaded.")
    }

    /// Hands the source over as a JSON string argument — never interpolated
    /// into markup, so a diagram cannot break out of its own render call.
    func render() {
        guard loaded, let webView else { return }
        var request: [String: Any] = ["id": "native", "source": source, "theme": dark ? "dark" : "light"]
        if let fit { request["fit"] = fit }
        guard let data = try? JSONSerialization.data(withJSONObject: request),
              let json = String(data: data, encoding: .utf8),
              let literal = try? JSONSerialization.data(withJSONObject: [json]),
              let wrapped = String(data: literal, encoding: .utf8)
        else {
            onFailure("The diagram could not be prepared.")
            return
        }
        // `wrapped` is a JSON array literal, so `[0]` yields a correctly
        // escaped JS string with no manual quoting.
        webView.evaluateJavaScript("window.flowMermaidRender(\(wrapped)[0])")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["flowMermaid"] as? String else { return }
        switch kind {
        case "ready":
            render()
        case "result":
            if body["ok"] as? Bool == true {
                onHeight(CGFloat((body["height"] as? NSNumber)?.doubleValue ?? 24))
            } else {
                onFailure((body["error"] as? String) ?? "The diagram could not be rendered.")
            }
        case "resize":
            onHeight(CGFloat((body["height"] as? NSNumber)?.doubleValue ?? 24))
        case "activate":
            onActivate()
        case "dismiss":
            onDismiss()
        default:
            break
        }
    }
}

/// Builds the isolated web view both platforms use: ephemeral data store, no
/// autofill, and one message handler for the page's replies.
private func makeMermaidWebView(_ coordinator: MermaidCoordinator) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(coordinator, name: "flowMermaid")
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = coordinator
    coordinator.webView = view
    #if os(iOS)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.isScrollEnabled = false
    #else
    view.setValue(false, forKey: "drawsBackground")
    #endif
    view.load(URLRequest(url: sandboxURL))
    return view
}

#if os(iOS)
private struct MermaidWebView: UIViewRepresentable {
    let source: String
    let dark: Bool
    var fit: String?
    let onHeight: (CGFloat) -> Void
    let onFailure: (String) -> Void
    var onActivate: () -> Void = {}
    var onDismiss: () -> Void = {}

    func makeCoordinator() -> MermaidCoordinator {
        MermaidCoordinator(
            source: source, dark: dark, fit: fit,
            onHeight: onHeight, onFailure: onFailure, onActivate: onActivate, onDismiss: onDismiss
        )
    }

    func makeUIView(context: Context) -> WKWebView { makeMermaidWebView(context.coordinator) }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.source != source || context.coordinator.dark != dark else { return }
        context.coordinator.source = source
        context.coordinator.dark = dark
        context.coordinator.render()
    }
}
#else
private struct MermaidWebView: NSViewRepresentable {
    let source: String
    let dark: Bool
    var fit: String?
    let onHeight: (CGFloat) -> Void
    let onFailure: (String) -> Void
    var onActivate: () -> Void = {}
    var onDismiss: () -> Void = {}

    func makeCoordinator() -> MermaidCoordinator {
        MermaidCoordinator(
            source: source, dark: dark, fit: fit,
            onHeight: onHeight, onFailure: onFailure, onActivate: onActivate, onDismiss: onDismiss
        )
    }

    func makeNSView(context: Context) -> WKWebView { makeMermaidWebView(context.coordinator) }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.source != source || context.coordinator.dark != dark else { return }
        context.coordinator.source = source
        context.coordinator.dark = dark
        context.coordinator.render()
    }
}
#endif
