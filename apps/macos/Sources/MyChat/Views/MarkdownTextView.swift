import AppKit
import SwiftUI

// MARK: - NSTextView subclass

/// Composer text view (phase-3.5 ruling 2): live blockquote / code-fence
/// styling, image-paste routing, and initial-focus handling.
final class MarkdownNSTextView: NSTextView {
    /// Returns true when the pasteboard held images that were routed to the
    /// attachment upload flow; false falls through to normal text pasting.
    var onPasteImages: ((NSPasteboard) -> Bool)?
    var wantsInitialFocus = true

    /// A plain-text NSTextView refuses pasteboards it can't read as text, so
    /// Cmd-V / Edit>Paste with an image-only clipboard never even reaches
    /// paste(_:) (QA s0854 finding). Advertise image + file-URL types so the
    /// action stays enabled; our paste override routes them to the upload flow.
    override var readablePasteboardTypes: [NSPasteboard.PasteboardType] {
        super.readablePasteboardTypes + [.png, .tiff, .fileURL]
    }

    override func paste(_ sender: Any?) {
        if onPasteImages?(NSPasteboard.general) == true { return }
        super.paste(sender)
    }

    /// Files dropped on the composer attach (with preview) instead of
    /// inserting their filesystem paths as text (phase-3.5 fix).
    var onDropFiles: (([URL]) -> Bool)?

    private static func droppedFileURLs(_ info: NSDraggingInfo) -> [URL] {
        (info.draggingPasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]
        ) as? [URL]) ?? []
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if onDropFiles != nil, !Self.droppedFileURLs(sender).isEmpty { return .copy }
        return super.draggingEntered(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = Self.droppedFileURLs(sender)
        if !urls.isEmpty, let onDropFiles, onDropFiles(urls) { return true }
        return super.performDragOperation(sender)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if wantsInitialFocus, let window {
            wantsInitialFocus = false
            window.makeFirstResponder(self)
        }
    }
}

// MARK: - Live styling

/// Attribute-only markdown styling for the composer's NSTextStorage.
@MainActor
enum ComposerMarkdownStyler {
    static let bodyFont = NSFont.systemFont(ofSize: 13)
    static let codeFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    static let ink = NSColor(MC.ink)
    static let inkSoft = NSColor(MC.inkSoft)
    static let fenceMarker = NSColor(MC.muted)
    static let codeBackground = NSColor(MC.codeBg)
    static let quoteBackground = NSColor(MC.accent).withAlphaComponent(0.07)

    static let defaultAttributes: [NSAttributedString.Key: Any] = [
        .font: bodyFont,
        .foregroundColor: ink,
        .paragraphStyle: NSParagraphStyle.default,
    ]

    static let quoteParagraph: NSParagraphStyle = {
        let p = NSMutableParagraphStyle()
        p.headIndent = 12
        p.firstLineHeadIndent = 12
        return p
    }()

    /// Re-derives block styling for the whole buffer. Attribute-only: the
    /// string and the selection are never touched, so the caret position,
    /// undo stack, and IME state survive every pass. Skipped while marked
    /// (IME composition) text is active — restyling composition underlines
    /// would break input methods; the next committed edit restyles.
    static func restyle(_ textView: NSTextView) {
        guard !textView.hasMarkedText(), let storage = textView.textStorage else { return }
        storage.beginEditing()
        storage.setAttributes(defaultAttributes, range: NSRange(location: 0, length: storage.length))
        for (range, kind) in MarkdownBlocks.classifiedLineRanges(storage.string) {
            switch kind {
            case .plain:
                break
            case .quote:
                storage.addAttributes([
                    .foregroundColor: inkSoft,
                    .backgroundColor: quoteBackground,
                    .paragraphStyle: quoteParagraph,
                ], range: range)
            case .fence:
                // Fence markers are hidden in the composer (operator fix):
                // the block reads as one code area; the tiny invisible rows
                // become its top/bottom padding.
                storage.addAttributes([
                    .font: NSFont.monospacedSystemFont(ofSize: 5, weight: .regular),
                    .foregroundColor: codeBackground,
                    .backgroundColor: codeBackground,
                ], range: range)
            case .code:
                storage.addAttributes([
                    .font: codeFont,
                    .backgroundColor: codeBackground,
                ], range: range)
            }
        }
        storage.endEditing()
        textView.typingAttributes = defaultAttributes
    }
}

// MARK: - SwiftUI wrapper

/// Replaces the composer's SwiftUI TextField. Binds to `text` (external
/// writes — suggestion insertion, post-send clear — are accepted with the
/// caret parked at the end), auto-grows between 1 and ~8 lines then scrolls,
/// sends on Return (Shift+Return inserts a newline), and re-runs the
/// attribute-only styling pass on every edit.
///
/// AX note: exposes the same identifier as the old TextField, but the role
/// changes from text field to text area (NSTextView).
struct MarkdownComposerTextView: NSViewRepresentable {
    @Binding var text: String
    let axIdentifier: String
    var focusRequest: Int
    let onSend: () -> Void
    let onPasteImages: (NSPasteboard) -> Bool
    /// Consulted first for key commands (arrows/Return/Tab/Escape) so the
    /// autocomplete popup can navigate/accept/dismiss. Return true = consumed.
    var onCommand: ((Selector) -> Bool)? = nil
    /// Files dropped onto the text view route here (upload-then-attach)
    /// instead of inserting their paths as text. Return true = consumed.
    var onDropFiles: (([URL]) -> Bool)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, onSend: onSend)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = MarkdownNSTextView(usingTextLayoutManager: false)
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 0, height: 2)
        textView.font = ComposerMarkdownStyler.bodyFont
        textView.textColor = ComposerMarkdownStyler.ink
        textView.typingAttributes = ComposerMarkdownStyler.defaultAttributes
        textView.setAccessibilityIdentifier(axIdentifier)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(
            width: 0, height: CGFloat.greatestFiniteMagnitude
        )
        context.coordinator.textView = textView

        if !text.isEmpty {
            textView.string = text
            ComposerMarkdownStyler.restyle(textView)
        }

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.text = $text
        coordinator.onSend = onSend
        coordinator.onCommand = onCommand
        guard let textView = scroll.documentView as? MarkdownNSTextView else { return }
        textView.onPasteImages = onPasteImages
        textView.onDropFiles = onDropFiles
        if textView.string != text {
            // Programmatic replace (suggestion inserted, message sent, …):
            // caret-to-end is the agreed behavior after external writes.
            textView.string = text
            textView.setSelectedRange(NSRange(location: (text as NSString).length, length: 0))
            ComposerMarkdownStyler.restyle(textView)
            textView.scrollRangeToVisible(textView.selectedRange())
        }
        if coordinator.lastFocusRequest != focusRequest {
            coordinator.lastFocusRequest = focusRequest
            DispatchQueue.main.async { [weak textView] in
                textView?.window?.makeFirstResponder(textView)
            }
        }
    }

    /// Auto-grow: single line up to ~8 lines of the body font, then the
    /// scroll view takes over.
    func sizeThatFits(
        _ proposal: ProposedViewSize, nsView: NSScrollView, context: Context
    ) -> CGSize? {
        guard let textView = nsView.documentView as? NSTextView,
              let container = textView.textContainer,
              let layout = textView.layoutManager
        else { return nil }
        let width = proposal.width ?? textView.frame.width
        guard width > 0, width.isFinite else { return nil }
        if abs(textView.frame.width - width) > 0.5 {
            textView.setFrameSize(NSSize(width: width, height: textView.frame.height))
        }
        layout.ensureLayout(for: container)
        let insets = textView.textContainerInset.height * 2
        let lineHeight = layout.defaultLineHeight(for: ComposerMarkdownStyler.bodyFont)
        let minHeight = ceil(lineHeight + insets)
        let maxHeight = ceil(lineHeight * 8 + insets)
        let used = ceil(layout.usedRect(for: container).height + insets)
        return CGSize(width: width, height: max(minHeight, min(maxHeight, used)))
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        var onSend: () -> Void
        var onCommand: ((Selector) -> Bool)?
        var lastFocusRequest = 0
        weak var textView: MarkdownNSTextView?

        init(text: Binding<String>, onSend: @escaping () -> Void) {
            self.text = text
            self.onSend = onSend
        }

        private var autoClosing = false

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            if !autoClosing { autoCloseFence(textView) }
            ComposerMarkdownStyler.restyle(textView)
            if text.wrappedValue != textView.string {
                text.wrappedValue = textView.string
            }
        }

        /// Typing the third backtick of a new opening fence turns it into an
        /// enterable code block: the closing fence is inserted and the caret
        /// parked on the empty line between (operator fix, phase 3.5).
        private func autoCloseFence(_ tv: NSTextView) {
            let ns = tv.string as NSString
            let sel = tv.selectedRange()
            let caret = sel.location
            guard sel.length == 0, caret > 0, caret <= ns.length else { return }
            let lineRange = ns.lineRange(for: NSRange(location: caret - 1, length: 0))
            var line = ns.substring(with: lineRange)
            var contentLen = (line as NSString).length
            if line.hasSuffix("\n") { line.removeLast(); contentLen -= 1 }
            guard line == "```", caret == lineRange.location + contentLen else { return }
            // must be an OPENING fence (even fence count before) with no fence after
            let before = ns.substring(to: lineRange.location)
            let fencesBefore = MarkdownBlocks.kinds(of: MarkdownBlocks.lines(before))
                .filter { $0 == .fence }.count
            guard fencesBefore % 2 == 0 else { return }
            let after = ns.substring(from: min(ns.length, NSMaxRange(lineRange)))
            let fenceAfter = MarkdownBlocks.kinds(of: MarkdownBlocks.lines(after)).contains(.fence)
            guard !fenceAfter else { return }
            autoClosing = true
            tv.insertText("\n\n```", replacementRange: NSRange(location: caret, length: 0))
            tv.setSelectedRange(NSRange(location: caret + 1, length: 0))
            autoClosing = false
        }

        /// Escape or Delete inside a code block with no content removes the
        /// whole block (operator fix, phase 3.5). Returns true when handled.
        private func removeEmptyFenceBlock(_ tv: NSTextView) -> Bool {
            let sel = tv.selectedRange()
            guard sel.length == 0 else { return false }
            let caret = sel.location
            let ranges = MarkdownBlocks.classifiedLineRanges(tv.string)
            guard !ranges.isEmpty else { return false }
            let i = ranges.firstIndex { caret < NSMaxRange($0.range) } ?? ranges.count - 1
            guard ranges[i].kind == .code || ranges[i].kind == .fence else { return false }
            // locate the fence pair (or unclosed trailing fence) containing line i
            var openIdx: Int?
            var found: (open: Int, close: Int?)?
            for (j, r) in ranges.enumerated() where r.kind == .fence {
                if let o = openIdx {
                    if o <= i, i <= j { found = (o, j) }
                    openIdx = nil
                    if found != nil { break }
                } else {
                    openIdx = j
                }
            }
            if found == nil, let o = openIdx, o <= i { found = (o, nil) }
            guard let region = found else { return false }
            let ns = tv.string as NSString
            let interiorEnd = region.close ?? ranges.count
            let interior = ranges[(region.open + 1)..<interiorEnd]
                .filter { $0.kind == .code }
                .map { ns.substring(with: $0.range) }
                .joined()
            guard interior.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
            let start = ranges[region.open].range.location
            let end = region.close.map { NSMaxRange(ranges[$0].range) } ?? ns.length
            let removal = NSRange(location: start, length: end - start)
            guard tv.shouldChangeText(in: removal, replacementString: "") else { return false }
            tv.textStorage?.replaceCharacters(in: removal, with: "")
            tv.didChangeText()
            tv.setSelectedRange(NSRange(location: start, length: 0))
            return true
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if let onCommand, onCommand(commandSelector) { return true }
            if commandSelector == #selector(NSResponder.cancelOperation(_:))
                || commandSelector == #selector(NSResponder.deleteBackward(_:)) {
                if removeEmptyFenceBlock(textView) { return true }
            }
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                // Shift+Return inserts a newline; plain Return sends — except
                // inside a code block, where Return types a code line (leave
                // the block with ↓/End, or Esc/Delete when empty).
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                    return false
                }
                if caretInsideCode(textView) { return false }
                onSend()
                return true
            }
            return false
        }

        private func caretInsideCode(_ tv: NSTextView) -> Bool {
            let caret = tv.selectedRange().location
            let ranges = MarkdownBlocks.classifiedLineRanges(tv.string)
            guard !ranges.isEmpty else { return false }
            let i = ranges.firstIndex { caret < NSMaxRange($0.range) } ?? ranges.count - 1
            return ranges[i].kind == .code
        }
    }
}
