import Foundation

/// Document logic for the built-in help viewer (#384) — the part worth keeping
/// out of the view and under test.
///
/// Help pages are markdown files in the repo (`docs/help/`) served by
/// `/v1/help` (#383), so the client's job is only to pick a topic and render
/// the source. Rendering reuses `MarkdownBlocks`, the grammar message bodies
/// use, so docs look like the rest of the app.
enum HelpDoc {
    /// The topic every client opens on; the server always ships `home.md`.
    static let home = "home"

    /// Which topic the viewer opens on: Home, or — on a server whose docs
    /// directory somehow has no `home.md` — the first topic it does list, so
    /// the viewer never opens on a page that isn't there. nil means no topics.
    static func openingSlug(_ topics: [HelpTopic]) -> String? {
        topics.contains { $0.slug == home } ? home : topics.first?.slug
    }

    /// Fold a soft-wrapped source line back onto the line it continues.
    ///
    /// Help markdown wraps at ~80 columns in the file, and a wrapped *bullet*
    /// continues on an indented line. `MarkdownBlocks` ends the list run at
    /// that line, so the tail of the bullet rendered as a stray un-indented
    /// paragraph beneath it. The other two renderers of this same text already
    /// fold it — the version menu in `FeatureNotes.parse`, the web viewer in
    /// `unwrap` — and the What's New page (#474) is generated from FEATURES.md,
    /// whose bullets are always wrapped, so no amount of authoring avoids it.
    ///
    /// Fenced code is left byte-for-byte alone, and an indented line that opens
    /// a list marker of its own is a nested item rather than a continuation.
    static func unwrap(_ markdown: String) -> String {
        MarkdownBlocks.mapNonCode(markdown) { run in
            var out: [String] = []
            for line in run.components(separatedBy: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let indented = line.hasPrefix(" ") || line.hasPrefix("\t")
                if indented, !trimmed.isEmpty, !opensListItem(trimmed), let last = out.last,
                   !last.trimmingCharacters(in: .whitespaces).isEmpty {
                    out[out.count - 1] = last + " " + trimmed
                } else {
                    out.append(line)
                }
            }
            return out.joined(separator: "\n")
        }
    }

    /// Does this line start a list item — `- `, `* `, `+ `, or `1. ` / `1) `?
    private static func opensListItem(_ trimmed: String) -> Bool {
        for marker in ["- ", "* ", "+ "] where trimmed.hasPrefix(marker) { return true }
        let digits = trimmed.prefix { $0.isNumber }
        guard !digits.isEmpty else { return false }
        let rest = trimmed.dropFirst(digits.count)
        return rest.hasPrefix(". ") || rest.hasPrefix(") ")
    }

    /// A page's markdown as blocks. The message grammar, with one difference:
    /// doc prose is soft-wrapped at ~80 columns in the source file, and a
    /// message body renders those line breaks literally — which would leave
    /// help ragged at a fixed width whatever the pane. So paragraph runs are
    /// folded back into one line and left to wrap to the pane. Web does the
    /// same thing by dropping `whitespace-pre-wrap` on the help container.
    ///
    /// Folding is also why a run has to be split on its blank lines here: the
    /// message grammar keeps consecutive prose in one `.paragraph`, blank
    /// lines and all, because a message renders those as the gap you see.
    /// Reflowed, they would run two paragraphs into one sentence stream.
    static func blocks(_ markdown: String) -> [MarkdownBlocks.Segment] {
        MarkdownBlocks.segments(unwrap(markdown)).flatMap { segment -> [MarkdownBlocks.Segment] in
            guard case let .paragraph(text) = segment else { return [segment] }
            return paragraphs(text).map { .paragraph($0) }
        }
    }

    /// One prose run → its paragraphs, each folded onto a single line.
    static func paragraphs(_ text: String) -> [String] {
        var out: [String] = []
        var current: [String] = []
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                if !current.isEmpty { out.append(current.joined(separator: " ")) }
                current = []
            } else {
                current.append(trimmed)
            }
        }
        if !current.isEmpty { out.append(current.joined(separator: " ")) }
        return out
    }

    /// Join a block's source lines back into one line.
    static func reflow(_ text: String) -> String {
        text
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
