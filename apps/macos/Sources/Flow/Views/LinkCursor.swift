import AppKit
import SwiftUI

extension View {
    /// Pointing-hand cursor while the mouse is over a hyperlink inside a
    /// `Text` rendering `attributed` (#81).
    ///
    /// Two problems to solve. SwiftUI offers no hover hit-testing *inside*
    /// laid-out text, so the link's on-screen rectangles are recovered by
    /// re-laying the same string with TextKit at the width SwiftUI gave the
    /// view. And owning the cursor takes more than asking for it: a selectable
    /// `Text` re-asserts the I-beam as the mouse moves, and an overlay that
    /// declines every mouse event (`hitTest` -> nil) is skipped by the same
    /// hit-test walk AppKit uses to decide whose cursor rects apply, so it lost
    /// every time. That is why the hand never appeared on a message paragraph
    /// or a heading — the surfaces that are selectable (#276).
    ///
    /// The overlay now accepts hit testing over the link rectangles *only*.
    /// Inside one it is the frontmost view, so its cursor rect wins and the
    /// click is its own — it opens the URL the `Text` would have opened.
    /// Everywhere else it is transparent, and selection behaves as before.
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

    /// Link rectangles at the current width, in the text's own coordinates,
    /// each with the URL it points at. Empty — and free — for the overwhelming
    /// majority of messages, which carry no links at all.
    @State private var targets: [LinkHitTest.LinkTarget] = []
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
            .overlay(LinkCursorOverlay(targets: targets))
    }

    private func measure(_ width: CGFloat) {
        let next = LinkHitTest.linkTargets(
            in: attributed, width: width, scale: textZoom, size: size
        )
        if next != targets { targets = next }
    }
}

/// Transparent AppKit layer that owns the cursor over the link rectangles —
/// and, because owning the cursor means being hit-testable there, the click too.
private struct LinkCursorOverlay: NSViewRepresentable {
    let targets: [LinkHitTest.LinkTarget]

    func makeNSView(context: Context) -> LinkCursorNSView { LinkCursorNSView() }

    func updateNSView(_ view: LinkCursorNSView, context: Context) {
        view.targets = targets
    }
}

private final class LinkCursorNSView: NSView {
    var targets: [LinkHitTest.LinkTarget] = [] {
        didSet {
            guard targets != oldValue else { return }
            window?.invalidateCursorRects(for: self)
            rebuildTrackingAreas()
        }
    }

    /// The link a mouse-down landed on, so a click that wanders off it before
    /// the mouse-up doesn't open anything — the standard button contract.
    private var pressed: URL?

    /// SwiftUI hands out top-left-origin rects; match them.
    override var isFlipped: Bool { true }

    /// Frontmost over a link, invisible everywhere else. Off the links the text
    /// underneath keeps every click, drag and selection it had before.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let superview else { return nil }
        return target(at: convert(point, from: superview)) == nil ? nil : self
    }

    override func resetCursorRects() {
        for target in targets {
            addCursorRect(target.rect, cursor: .pointingHand)
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        rebuildTrackingAreas()
    }

    /// A cursor rect is applied when the pointer enters it. That is enough on
    /// its own only if nothing else touches the cursor afterwards, and over
    /// selectable text something does — so the hand is re-asserted on every
    /// move inside the link as well.
    private func rebuildTrackingAreas() {
        for area in trackingAreas { removeTrackingArea(area) }
        for target in targets {
            addTrackingArea(NSTrackingArea(
                rect: target.rect,
                options: [.cursorUpdate, .mouseMoved, .activeInKeyWindow],
                owner: self
            ))
        }
    }

    override func cursorUpdate(with event: NSEvent) { NSCursor.pointingHand.set() }

    override func mouseMoved(with event: NSEvent) {
        guard target(at: convert(event.locationInWindow, from: nil)) != nil else { return }
        NSCursor.pointingHand.set()
    }

    // The click over a link is ours because the hit test is, so open the URL
    // the `Text` would have opened.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        pressed = target(at: convert(event.locationInWindow, from: nil))?.url
    }

    override func mouseUp(with event: NSEvent) {
        let released = target(at: convert(event.locationInWindow, from: nil))?.url
        if let url = pressed, url == released { NSWorkspace.shared.open(url) }
        pressed = nil
    }

    private func target(at point: NSPoint) -> LinkHitTest.LinkTarget? {
        targets.first { $0.rect.contains(point) }
    }
}

enum LinkHitTest {
    /// One wrapped line of a link run: where it is on screen, and where it goes.
    struct LinkTarget: Equatable {
        let rect: CGRect
        let url: URL
    }

    /// The on-screen rectangles covered by link runs, one per wrapped line, in
    /// the text view's own (top-left origin) coordinates, each carrying the URL
    /// it points at — the overlay owns the click as well as the cursor.
    static func linkTargets(
        in attributed: AttributedString, width: CGFloat, scale: CGFloat = 1,
        size: CGFloat? = nil
    ) -> [LinkTarget] {
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

        var targets: [LinkTarget] = []
        storage.enumerateAttribute(.link, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            guard let url = url(from: value) else { return }
            let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            manager.enumerateEnclosingRects(
                forGlyphRange: glyphs,
                withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
                in: container
            ) { rect, _ in targets.append(LinkTarget(rect: rect, url: url)) }
        }
        return targets
    }

    /// Just the rectangles, for callers (and tests) that don't need the target.
    static func linkRects(
        in attributed: AttributedString, width: CGFloat, scale: CGFloat = 1,
        size: CGFloat? = nil
    ) -> [CGRect] {
        linkTargets(in: attributed, width: width, scale: scale, size: size).map(\.rect)
    }

    /// `.link` holds an `NSURL` for everything AttributedString produces, but
    /// the attribute is also allowed to hold a string.
    private static func url(from value: Any?) -> URL? {
        if let url = value as? URL { return url }
        if let string = value as? String { return URL(string: string) }
        return nil
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
