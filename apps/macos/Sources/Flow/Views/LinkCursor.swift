import AppKit
import SwiftUI

extension View {
    /// Pointing-hand cursor while the mouse is over a hyperlink inside a
    /// `Text` rendering `attributed` (#81).
    ///
    /// SwiftUI renders markdown links but offers no hover hit-testing *inside*
    /// laid-out text, and `.textSelection(.enabled)` puts an I-beam over the
    /// whole paragraph — so a link reads as plain text under the cursor. We
    /// re-lay the same string with TextKit at the width SwiftUI gave the view
    /// and hit-test the hovered point against the link runs. Line breaking can
    /// differ from SwiftUI's by a hair at wrap points; for a cursor affordance
    /// that isn't observable.
    func linkCursor(_ attributed: AttributedString) -> some View {
        modifier(LinkCursorModifier(attributed: attributed))
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

    @State private var width: CGFloat = 0
    /// Link rectangles for the current width, laid out on first hover.
    @State private var rects: [CGRect]?
    @State private var overLink = false

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { width = geo.size.width }
                        .onChange(of: geo.size.width) { _, new in width = new }
                }
            )
            .onContinuousHover { phase in
                switch phase {
                case .active(let point): setOverLink(hits(point))
                case .ended: setOverLink(false)
                }
            }
            .onChange(of: width) { _, _ in rects = nil }
            .onChange(of: attributed) { _, _ in rects = nil }
            .onDisappear { setOverLink(false) }
    }

    private func hits(_ point: CGPoint) -> Bool {
        guard width > 0 else { return false }
        let boxes = rects ?? LinkHitTest.linkRects(in: attributed, width: width)
        if rects == nil { rects = boxes }
        return boxes.contains { $0.contains(point) }
    }

    /// push/pop have to stay balanced — a stray pop unwinds someone else's cursor.
    private func setOverLink(_ over: Bool) {
        guard over != overLink else { return }
        overLink = over
        if over { NSCursor.pointingHand.push() } else { NSCursor.pop() }
    }
}

enum LinkHitTest {
    /// The on-screen rectangles covered by link runs, one per wrapped line,
    /// in the text view's own (top-left origin) coordinates.
    static func linkRects(in attributed: AttributedString, width: CGFloat) -> [CGRect] {
        guard width > 0, attributed.runs.contains(where: { $0.link != nil }) else { return [] }

        let storage = NSTextStorage(attributedString: measurable(attributed))
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
    private static func measurable(_ attributed: AttributedString) -> NSAttributedString {
        let base = NSFont.preferredFont(forTextStyle: .callout)
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
