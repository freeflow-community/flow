import SwiftUI

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Rendered markdown **documents** (#569) — a `.md` artifact or attachment read
/// as prose instead of a wall of monospace, on macOS and iOS alike.
///
/// The grammar is `MarkdownBlocks`, the same segmentation the two message lists
/// use, so a document renders exactly what a message with the same body would:
/// headings, lists, GFM tables, fenced code, mermaid diagrams and the inline
/// pass (mention pills, `**bold**`, links). What differs is the container — a
/// document gets its own margins and a slightly looser rhythm than a chat row,
/// and it never carries a row's edited/pending markers.
///
/// This lives in `Support/` rather than either client's `Views/` because both
/// need it and every ingredient is already platform-agnostic: `MarkdownBlocks`,
/// `MentionRendering`, `MarkdownTableView`, `MermaidDiagramView` and the
/// `flowFont` text-zoom modifier are all shared. (On iOS the zoom scale is
/// always 1, so `flowFont` there is just the platform font size.)
struct MarkdownDocumentView: View {
    let text: String
    var userNames: [String: String] = [:]
    var currentUserId: String?

    /// Same cap the text panes use. `MarkdownBlocks.segments` walks every line
    /// and a mermaid fence spawns a web view apiece, so an unbounded document
    /// is a hang, not a slow render.
    static let maxChars = 1_000_000

    private var capped: String { String(text.prefix(Self.maxChars)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(MarkdownBlocks.segments(capped).enumerated()), id: \.offset) { _, segment in
                MarkdownDocumentSegment(segment: segment, userNames: userNames, currentUserId: currentUserId)
            }
            if text.count > Self.maxChars {
                Text("Showing the first 1 MB — download for the full file.")
                    .flowFont(.caption2)
                    .foregroundStyle(MC.faint)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Same #161 hazard as a message row: a multiline Text is the only
        // vertically flexible child here, so without this it is the one that
        // gives way when the pane proposes less height than the document wants
        // — and the prose renders cut off mid-paragraph.
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("markdown.document")
    }
}

/// One block. Styling tracks the message lists' `segmentView` deliberately —
/// the point of the issue is that a document looks like the messages it came
/// from — with document-scale headings and no row-level accessibility ids.
private struct MarkdownDocumentSegment: View {
    let segment: MarkdownBlocks.Segment
    let userNames: [String: String]
    let currentUserId: String?

    @Environment(\.textZoom) private var textZoom

    /// Body size per platform: `.callout` is 13pt on macOS and 16pt on iOS, and
    /// the heading scale is rebased on it exactly as each message list does.
    #if os(iOS)
    private static let bodySize: CGFloat = 16
    private static let h1Size: CGFloat = 21
    private static let h2Size: CGFloat = 19
    #else
    private static let bodySize: CGFloat = 13
    private static let h1Size: CGFloat = 17
    private static let h2Size: CGFloat = 15.5
    #endif

    var body: some View {
        switch segment {
        case .paragraph(let text):
            paragraphText(text)
        case .quote(let text):
            // Overlay, not an HStack sibling (#195): a Shape has no ideal
            // height, so as a sibling it absorbs space the quoted text needs
            // and the bar runs on past the last line.
            paragraphText(text)
                .foregroundStyle(MC.inkSoft)
                .padding(.leading, 11)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(MC.accent.opacity(0.55))
                        .frame(width: 3)
                }
        case .heading(let level, let text):
            headingText(level: level, text: text)
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text.isEmpty ? " " : text)
                    .flowFont(size: 12, design: .monospaced)
                    .foregroundStyle(MC.ink)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
        case .mermaid(let source):
            MermaidDiagramView(source: source)
        case .table(let header, let align, let rows):
            MarkdownTableView(
                header: header, align: align, rows: rows,
                userNames: userNames, currentUserId: currentUserId
            )
        case .ulist(let items):
            listView(items.map { (marker: "•", text: $0) })
        case .olist(let start, let items):
            listView(items.enumerated().map { (marker: "\(start + $0.offset).", text: $0.element) })
        case .hr:
            Rectangle()
                .fill(MC.hairline)
                .frame(height: 1)
                .padding(.vertical, 4)
        }
    }

    /// ATX headings, rebased on the platform's body size exactly as each
    /// message list does — h1/h2 step up by web's own ratios, h3-h6 stay
    /// body-size and are distinguished by weight.
    private func headingText(level: Int, text: String) -> some View {
        let size: CGFloat = level == 1 ? Self.h1Size : (level == 2 ? Self.h2Size : Self.bodySize)
        return Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId, scale: textZoom))
            .flowFont(size: size, weight: level <= 3 ? .bold : .semibold)
            .foregroundStyle(MC.ink)
            .textSelection(.enabled)
            .padding(.top, level <= 2 ? 6 : 2) // a document breathes more than a chat row
            .accessibilityAddTraits(.isHeader)
    }

    private func listView(_ items: [(marker: String, text: String)]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.marker)
                        .flowFont(.callout)
                        .foregroundStyle(MC.inkSoft)
                        .frame(minWidth: 16, alignment: .trailing)
                    paragraphText(item.text)
                }
            }
        }
        .padding(.leading, 2)
    }

    private func paragraphText(_ text: String) -> some View {
        Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId, scale: textZoom))
            .flowFont(.callout)
            .foregroundStyle(MC.ink)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The whole viewer: a rendered document with the **View source** toggle and a
/// copy-raw control the issue asks for, scrolling under a thin control strip.
/// Shared so the affordance sits in the same place on both clients.
///
/// Callers own the fetch (each client's engine differs in how it reports
/// failure) and hand the text in.
struct MarkdownDocumentPane: View {
    let text: String
    var userNames: [String: String] = [:]
    var currentUserId: String?

    @State private var showSource = false
    @State private var copied = false

    #if os(iOS)
    private static let hPad: CGFloat = 16
    private static let vPad: CGFloat = 12
    #else
    private static let hPad: CGFloat = 22
    private static let vPad: CGFloat = 14
    #endif

    var body: some View {
        VStack(spacing: 0) {
            controls
            Divider().overlay(MC.hairline)
            if showSource {
                // The raw half of the toggle is deliberately the very same
                // presentation a .txt artifact gets, so "View source" means
                // "show me the file", not "show me another rendering".
                ScrollView([.horizontal, .vertical]) {
                    Text(String(text.prefix(MarkdownDocumentView.maxChars)))
                        .flowFont(size: 12, design: .monospaced)
                        .foregroundStyle(MC.ink)
                        .textSelection(.enabled)
                        .padding(.horizontal, Self.hPad)
                        .padding(.vertical, Self.vPad)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityIdentifier("markdown.source")
            } else {
                ScrollView(.vertical) {
                    MarkdownDocumentView(text: text, userNames: userNames, currentUserId: currentUserId)
                        .padding(.horizontal, Self.hPad)
                        .padding(.vertical, Self.vPad)
                }
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 4) {
            Spacer()
            Button(showSource ? "Rendered" : "View source") { showSource.toggle() }
                .buttonStyle(.plain)
                .flowFont(.caption, weight: .semibold)
                .foregroundStyle(MC.accentSoft)
                .help(showSource ? "Show the rendered document" : "Show the raw markdown")
                .accessibilityIdentifier("markdown.toggleSource")
            Button(copied ? "Copied" : "Copy") { copySource() }
                .buttonStyle(.plain)
                .flowFont(.caption, weight: .semibold)
                .foregroundStyle(MC.accentSoft)
                .help("Copy the raw markdown")
                .accessibilityIdentifier("markdown.copySource")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    // Same shape as MermaidCopyButton, which already does this on both
    // platforms — pasteboard, then a short "Copied" acknowledgement.
    private func copySource() {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        copied = true
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            copied = false
        }
    }
}
