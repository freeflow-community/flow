import AppKit
import SwiftUI

extension View {
    /// Pointing-hand cursor while the mouse is over a hyperlink inside a
    /// `Text` rendering `attributed` (#81).
    ///
    /// Two problems to solve. SwiftUI offers no hover hit-testing *inside*
    /// laid-out text, so the link's on-screen rectangles are recovered by
    /// re-laying the same string with TextKit at the width SwiftUI gave the
    /// view. And a selectable `Text` re-asserts its own cursor as the mouse
    /// moves — an `NSCursor.push()` or `set()` driven from `.onContinuousHover`
    /// is overwritten by the next mouse-moved event (verified in the running
    /// app) — so the cursor is claimed the way AppKit expects instead: cursor
    /// rects on a transparent overlay view above the text, which never takes a
    /// mouse event itself.
    ///
    /// TextKit's line breaking can differ from SwiftUI's by a hair at wrap
    /// points; for a cursor affordance that isn't observable.
    ///
    /// `size` is the point size the text is drawn at before zoom, for callers
    /// that don't use body size — a heading, a table cell, the channel topic.
    /// Get it wrong and the rects are the right shape at the wrong width, so
    /// the hand appears beside the link instead of on it. Default: `.callout`,
    /// which is what a message paragraph uses.
    func linkCursor(_ attributed: AttributedString, size: CGFloat? = nil) -> some View {
        modifier(LinkCursorModifier(attributed: attributed, size: size))
    }

    /// Pointing hand over a control that *reads* as a link (`.buttonStyle(.link)`),
    /// where AppKit leaves the arrow cursor in place.
    func pointingHandCursor() -> some View {
        onHover { inside in
            if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() }
        }
    }
}

private struct LinkCursorModifier: ViewModifier {
    let attributed: AttributedString
    /// Drawn point size before zoom; nil = `.callout`.
    let size: CGFloat?

    /// Link rectangles at the current width, in the text's own coordinates.
    /// Empty — and free — for the overwhelming majority of messages, which
    /// carry no links at all.
    @State private var rects: [CGRect] = []
    /// The re-layout has to use the size the text is actually drawn at, or the
    /// cursor rects drift away from the links as soon as you zoom (#105).
    @Environment(\.textZoom) private var textZoom

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { measure(geo.size.width) }
                        .onChange(of: geo.size.width) { _, new in measure(new) }
                        .onChange(of: attributed) { _, _ in measure(geo.size.width) }
                        .onChange(of: textZoom) { _, _ in measure(geo.size.width) }
                }
            )
            .overlay(LinkCursorOverlay(rects: rects).allowsHitTesting(false))
    }

    private func measure(_ width: CGFloat) {
        let next = LinkHitTest.linkRects(
            in: attributed, width: width, scale: textZoom, size: size
        )
        if next != rects { rects = next }
    }
}

/// Transparent AppKit layer whose only job is owning the cursor over the link
/// rectangles. `hitTest` returns nil, so clicks, drags and text selection go
/// to the text underneath exactly as they did before.
private struct LinkCursorOverlay: NSViewRepresentable {
    let rects: [CGRect]

    func makeNSView(context: Context) -> LinkCursorNSView { LinkCursorNSView() }

    func updateNSView(_ view: LinkCursorNSView, context: Context) {
        view.linkRects = rects
    }
}

private final class LinkCursorNSView: NSView {
    var linkRects: [CGRect] = [] {
        didSet {
            guard linkRects != oldValue else { return }
            window?.invalidateCursorRects(for: self)
        }
    }

    /// SwiftUI hands out top-left-origin rects; match them.
    override var isFlipped: Bool { true }

    /// Never intercept a mouse event — this view exists only for its cursor.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func resetCursorRects() {
        for rect in linkRects {
            addCursorRect(rect, cursor: .pointingHand)
        }
    }
}

enum LinkHitTest {
    /// The on-screen rectangles covered by link runs, one per wrapped line,
    /// in the text view's own (top-left origin) coordinates.
    static func linkRects(
        in attributed: AttributedString, width: CGFloat, scale: CGFloat = 1,
        size: CGFloat? = nil
    ) -> [CGRect] {
        guard width > 0, attributed.runs.contains(where: { $0.link != nil }) else { return [] }

        let storage = NSTextStorage(
            attributedString: measurable(attributed, scale: scale, size: size)
        )
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)
        manager.ensureLayout(for: container)

        var rects: [CGRect] = []
        storage.enumerateAttribute(.link, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            guard value != nil else { return }
            let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            manager.enumerateEnclosingRects(
                forGlyphRange: glyphs,
                withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
                in: container
            ) { rect, _ in rects.append(rect) }
        }
        return rects
    }

    /// SwiftUI-scope attributes (the mention-pill font, the view-level
    /// `.callout`) don't survive the bridge to `NSAttributedString`, so rebuild
    /// the string run by run with the AppKit fonts SwiftUI is drawing.
    private static func measurable(
        _ attributed: AttributedString, scale: CGFloat, size: CGFloat?
    ) -> NSAttributedString {
        let callout = NSFont.preferredFont(forTextStyle: .callout)
        let points = (size ?? callout.pointSize) * scale
        let base = size == nil && scale == 1
            ? callout
            : NSFont.systemFont(ofSize: points)
        let manager = NSFontManager.shared
        let bold = manager.convert(base, toHaveTrait: .boldFontMask)
        let italic = manager.convert(base, toHaveTrait: .italicFontMask)

        let out = NSMutableAttributedString()
        for run in attributed.runs {
            let intent = run.inlinePresentationIntent ?? []
            // Mention pills carry a background colour and a bold callout;
            // markdown emphasis arrives as a presentation intent.
            let strong = intent.contains(.stronglyEmphasized) || run.backgroundColor != nil
            let font = strong ? bold : (intent.contains(.emphasized) ? italic : base)
            var attrs: [NSAttributedString.Key: Any] = [.font: font]
            if let link = run.link { attrs[.link] = link }
            out.append(NSAttributedString(string: String(attributed[run.range].characters), attributes: attrs))
        }
        return out
    }
}
